package main

import (
	"encoding/pem"
	"os"
	"testing"
)

func TestLegacyLocalRoot(t *testing.T) {
	raw, err := os.ReadFile("legacy-root-test.crt")
	if err != nil {
		t.Fatal(err)
	}
	block, _ := pem.Decode(raw)
	if block == nil || !isLocalRoot(block.Bytes) {
		t.Fatal("la raíz anterior debe reconocerse")
	}
	if isLocalRoot([]byte("inválido")) {
		t.Fatal("certificado no válido aceptado")
	}
}
