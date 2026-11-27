package main

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"time"
	"unsafe"
)

var adv = syscall.NewLazyDLL("advapi32.dll")
var crypt = syscall.NewLazyDLL("crypt32.dll")

func checkLink(p string) error {
	ptr, err := syscall.UTF16PtrFromString(p)
	if err != nil {
		return err
	}
	a, err := syscall.GetFileAttributes(ptr)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if a&syscall.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
		return fmt.Errorf("la carpeta contiene un enlace o una redirección: %s", p)
	}
	return nil
}

func isBusy(err error) bool {
	return errors.Is(err, syscall.Errno(32)) || errors.Is(err, syscall.Errno(33))
}

func lockData(data string) (func(), error) {
	path, _ := syscall.UTF16PtrFromString(filepath.Join(data, "session.lock"))
	for i := 0; i < 100; i++ {
		h, err := syscall.CreateFile(path, syscall.GENERIC_READ|syscall.GENERIC_WRITE, 0, nil, syscall.OPEN_ALWAYS, syscall.FILE_ATTRIBUTE_NORMAL, 0)
		if err == nil {
			return func() { syscall.CloseHandle(h) }, nil
		}
		if !isBusy(err) {
			return nil, err
		}
		bytes, err := os.ReadFile(filepath.Join(data, "active.json"))
		var active struct{ Instance string }
		if err == nil && json.Unmarshal(bytes, &active) == nil && len(active.Instance) == 32 {
			if _, err = hex.DecodeString(active.Instance); err == nil {
				if err = os.WriteFile(filepath.Join(data, "stop.request"), []byte(active.Instance), 0600); err != nil {
					return nil, err
				}
			}
		}
		time.Sleep(200 * time.Millisecond)
	}
	return nil, errors.New("el gateway sigue ocupado; se conservaron sus archivos. Vuelve a intentar la desinstalación")
}

func removeStartup() error {
	key, _ := syscall.UTF16PtrFromString(`Software\Microsoft\Windows\CurrentVersion\Run`)
	var h syscall.Handle
	err := syscall.RegOpenKeyEx(syscall.HKEY_CURRENT_USER, key, 0, syscall.KEY_SET_VALUE, &h)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	defer syscall.RegCloseKey(h)
	name, _ := syscall.UTF16PtrFromString("IoTSentinel")
	rc, _, _ := adv.NewProc("RegDeleteValueW").Call(uintptr(h), uintptr(unsafe.Pointer(name)))
	if rc == 0 || rc == 2 {
		return nil
	}
	return syscall.Errno(rc)
}

func removeTrust(data string) error {
	raw, err := os.ReadFile(filepath.Join(data, "https", "iotsentinel-local.crt"))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	block, _ := pem.Decode(raw)
	if block == nil {
		return errors.New("certificado local ilegible")
	}
	if block.Type != "CERTIFICATE" || !isLocalRoot(block.Bytes) {
		return errors.New("el certificado guardado no es la raíz de IoTSentinel")
	}
	name, _ := syscall.UTF16PtrFromString("Root")
	// CERT_STORE_PROV_SYSTEM_W, CURRENT_USER y OPEN_EXISTING.
	store, _, err := crypt.NewProc("CertOpenStore").Call(10, 0, 0, 0x10000|0x4000, uintptr(unsafe.Pointer(name)))
	if store == 0 {
		return err
	}
	defer crypt.NewProc("CertCloseStore").Call(store, 0)
	sum := sha1.Sum(block.Bytes)
	blob := struct {
		Size uint32
		Data *byte
	}{uint32(len(sum)), &sum[0]}
	ctx, _, err := crypt.NewProc("CertFindCertificateInStore").Call(store, 0x10001, 0, 0x10000, uintptr(unsafe.Pointer(&blob)), 0)
	if ctx == 0 {
		if errors.Is(err, syscall.Errno(0x80092004)) {
			return nil
		}
		return err
	}
	ok, _, err := crypt.NewProc("CertDeleteCertificateFromStore").Call(ctx)
	if ok == 0 {
		return err
	}
	return nil
}
