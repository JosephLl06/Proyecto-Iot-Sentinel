package main

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestPackageRemoval(t *testing.T) {
	root := t.TempDir()
	manifest := map[string]string{}
	for _, name := range []string{"IoTSentinel.exe", "main.py", "runtime/python.exe", "docs/informe.pdf"} {
		path := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("original"), 0600); err != nil {
			t.Fatal(err)
		}
		manifest[name] = fmt.Sprintf("%x", sha256.Sum256([]byte("original")))
	}
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	current = fmt.Sprintf("%x", sha256.Sum256(raw))
	inventoryPath := filepath.Join(root, inventory)
	if err = os.WriteFile(inventoryPath, raw, 0600); err != nil {
		t.Fatal(err)
	}
	entries, err := readInventory(root)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(inventoryPath, append(raw, ' '), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = readInventory(root); err == nil {
		t.Fatal("se aceptó un inventario modificado")
	}
	for _, name := range []string{"main.py", "notas.txt"} {
		if err = os.WriteFile(filepath.Join(root, name), []byte("personal"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = safe(root, "../ajeno"); err == nil {
		t.Fatal("ruta fuera de la instalación")
	}
	if err = removePackage(root, entries); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"main.py", "notas.txt"} {
		data, err := os.ReadFile(filepath.Join(root, name))
		if err != nil || string(data) != "personal" {
			t.Fatalf("no se conservó %s", name)
		}
	}
	for _, name := range []string{"runtime", "docs", "IoTSentinel.exe"} {
		if _, err := os.Stat(filepath.Join(root, name)); !os.IsNotExist(err) {
			t.Fatalf("quedó %s", name)
		}
	}
}
