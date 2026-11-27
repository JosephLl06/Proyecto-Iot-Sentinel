// Desinstalador independiente de IoTSentinel. No requiere el runtime del programa.
package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const inventory = "archivos-portatiles.json"
const edition9 = "c961a3762bb81e70dd90d7e54eda8bb6752df5a2fb40f6326dc498bee5f40517"
const previous = "ca77482c956f991f28f6d3bdd0d9c3a489c30590e1435e27467d603a61e08f75"

var current string // Huella del inventario suministrada al empaquetar esta edición.
var dataNames = []string{"sentinel.sqlite3", "sentinel.sqlite3-journal", "sentinel.sqlite3-wal", "sentinel.sqlite3-shm", "active.json", "active.new", "stop.request", "arranque.log", "session.lock", "https/panel-key.pem", "https/panel.pem", "https/iotsentinel-local.crt", "https/panel-key.new", "https/panel.new", "https/iotsentinel-local.new", "red-cr3/gateway.key", "red-cr3/gateway.crt", "red-cr3/receptor.key", "red-cr3/receptor.crt"}

func safe(root, name string) (string, error) {
	rel := filepath.FromSlash(name)
	if !filepath.IsLocal(rel) || filepath.Clean(rel) != rel || rel == "." || strings.ContainsAny(rel, ":") {
		return "", fmt.Errorf("ruta inválida: %s", name)
	}
	path := filepath.Join(root, rel)
	for p := path; ; p = filepath.Dir(p) {
		if err := checkLink(p); err != nil {
			return "", err
		}
		if p == root {
			break
		}
	}
	return path, nil
}

func readInventory(root string) (map[string]string, error) {
	p, err := safe(root, inventory)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(p)
	if err != nil {
		return nil, err
	}
	hash := fmt.Sprintf("%x", sha256.Sum256(data))
	if hash != current && hash != previous && hash != edition9 {
		return nil, errors.New("esta carpeta no corresponde a una edición compatible de IoTSentinel")
	}
	var entries map[string]string
	if err = json.Unmarshal(data, &entries); err != nil {
		return nil, err
	}
	for _, name := range []string{"main.py", "IoTSentinel.exe", "runtime/python.exe"} {
		if len(entries[name]) != 64 {
			return nil, errors.New("inventario incompleto")
		}
	}
	for name := range entries {
		if _, err = safe(root, name); err != nil {
			return nil, err
		}
	}
	return entries, nil
}

func removeFile(path string) error {
	var err error
	for i := 0; i < 30; i++ {
		err = os.Remove(path)
		if err == nil || os.IsNotExist(err) {
			return nil
		}
		if !os.IsPermission(err) && !isBusy(err) {
			return err
		}
		time.Sleep(200 * time.Millisecond)
	}
	return err
}

func removeEmpty(dir string) error {
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if len(entries) > 0 {
		return nil
	}
	return removeFile(dir)
}

func removePackage(root string, entries map[string]string) error {
	dirs := map[string]bool{}
	for name, digest := range entries {
		path, err := safe(root, name)
		if err != nil {
			return err
		}
		for p := filepath.Dir(path); p != root; p = filepath.Dir(p) {
			dirs[p] = true
		}
		f, err := os.Open(path)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		hash := sha256.New()
		_, err = io.Copy(hash, f)
		f.Close()
		if err != nil {
			return err
		}
		if fmt.Sprintf("%x", hash.Sum(nil)) != digest {
			fmt.Println("Se conserva el archivo modificado:", path)
			continue
		}
		if err = removeFile(path); err != nil {
			return err
		}
	}
	list := make([]string, 0, len(dirs))
	for d := range dirs {
		list = append(list, d)
	}
	sort.Slice(list, func(i, j int) bool { return len(list[i]) > len(list[j]) })
	for _, d := range list {
		if err := removeEmpty(d); err != nil {
			return err
		}
	}
	return nil
}

func uninstall(root, data string, entries map[string]string) error {
	for _, name := range dataNames {
		if _, err := safe(data, name); err != nil {
			return err
		}
	}
	if _, err := os.Stat(data); !os.IsNotExist(err) {
		if err != nil {
			return err
		}
		err = func() error {
			unlock, err := lockData(data)
			if err != nil {
				return err
			}
			defer unlock()
			if err = removeTrust(data); err != nil {
				return err
			}
			if err = removeStartup(); err != nil {
				return err
			}
			if err = removePackage(root, entries); err != nil {
				return err
			}
			for _, name := range dataNames {
				if name != "session.lock" {
					if err = removeFile(filepath.Join(data, filepath.FromSlash(name))); err != nil {
						return err
					}
				}
			}
			return nil
		}()
		if err != nil {
			return err
		}
		for _, p := range []string{"session.lock", "https", "red-cr3"} {
			path := filepath.Join(data, p)
			if p != "session.lock" {
				err = removeEmpty(path)
			} else {
				err = removeFile(path)
			}
			if err != nil {
				return err
			}
		}
		if err = removeEmpty(data); err != nil {
			return err
		}
	} else {
		if err = removeStartup(); err != nil {
			return err
		}
		if err = removePackage(root, entries); err != nil {
			return err
		}
	}
	if err := removeFile(filepath.Join(root, inventory)); err != nil {
		return err
	}
	return removeEmpty(root)
}

func run(in *bufio.Scanner) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	root := filepath.Join(filepath.Dir(exe), "IoTSentinel")
	fmt.Println("Carpeta del programa:", root)
	fmt.Println("Pulsa Intro para elegirla o pega la ruta de la carpeta de tu copia anterior.")
	if !in.Scan() {
		return errors.New("selección cancelada")
	}
	input := strings.Trim(strings.TrimSpace(in.Text()), "\"")
	if input != "" {
		if !filepath.IsAbs(input) {
			return errors.New("se necesita la ruta completa")
		}
		root = filepath.Clean(input)
	}
	entries, err := readInventory(root)
	if err != nil {
		return err
	}
	local := os.Getenv("LOCALAPPDATA")
	if !filepath.IsAbs(local) {
		return errors.New("perfil de Windows no disponible")
	}
	data := filepath.Join(local, "IoTSentinel")
	fmt.Printf("Se quitará el programa de %s\nSe borrarán la cuenta, historial, alertas y certificados locales de %s\n", root, data)
	fmt.Println("Todas tus copias de IoTSentinel de este usuario comparten esos datos. También se quitará el inicio automático anterior.")
	fmt.Print("Para confirmar escribe DESINSTALAR y pulsa Intro: ")
	if !in.Scan() || strings.TrimSpace(in.Text()) != "DESINSTALAR" {
		fmt.Println("Cancelado. Se conservaron los archivos.")
		return nil
	}
	if err = uninstall(root, data, entries); err != nil {
		return err
	}
	fmt.Println("IoTSentinel desinstalado. Puedes borrar este desinstalador independiente y el ZIP de descarga.")
	return nil
}

func main() {
	in := bufio.NewScanner(os.Stdin)
	err := run(in)
	if err != nil {
		fmt.Println("No se completó la desinstalación:", err)
	}
	fmt.Println("Pulsa Intro para cerrar.")
	in.Scan()
	if err != nil {
		os.Exit(1)
	}
}
