// Funciones que solo existen en la prueba de archivos, sin almacenes de Windows.
package main

import (
	"errors"
	"os"
)

func checkLink(path string) error {
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return errors.New("enlace")
	}
	return nil
}
func isBusy(error) bool               { return false }
func lockData(string) (func(), error) { panic("solo Windows") }
func removeTrust(string) error        { panic("solo Windows") }
func removeStartup() error            { panic("solo Windows") }
