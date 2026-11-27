package main

import (
	"bytes"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
)

// The store lookup always uses the digest of the original DER. Older local
// roots contain an excluded DNS subtree "." which Go's x509 parser rejects.
func isLocalRoot(der []byte) bool {
	cert, err := x509.ParseCertificate(der)
	if err == nil {
		return cert.Subject.CommonName == "IoTSentinel Local" && cert.IsCA
	}
	var outer struct {
		TBS       asn1.RawValue
		Algorithm pkix.AlgorithmIdentifier
		Signature asn1.BitString
	}
	rest, err := asn1.Unmarshal(der, &outer)
	if err != nil || len(rest) != 0 {
		return false
	}
	var tbs struct {
		Version    int `asn1:"explicit,tag:0"`
		Serial     asn1.RawValue
		Signature  pkix.AlgorithmIdentifier
		Issuer     pkix.RDNSequence
		Validity   asn1.RawValue
		Subject    pkix.RDNSequence
		PublicKey  asn1.RawValue
		Extensions []pkix.Extension `asn1:"explicit,tag:3"`
	}
	if _, err := asn1.Unmarshal(outer.TBS.FullBytes, &tbs); err != nil {
		return false
	}
	var issuer, subject pkix.Name
	issuer.FillFromRDNSequence(&tbs.Issuer)
	subject.FillFromRDNSequence(&tbs.Subject)
	if tbs.Version != 2 || issuer.CommonName != "IoTSentinel Local" || subject.CommonName != issuer.CommonName {
		return false
	}
	ca, legacy := false, false
	for _, ext := range tbs.Extensions {
		if ext.Critical && ext.Id.Equal(asn1.ObjectIdentifier{2, 5, 29, 19}) {
			// CA=true and pathLenConstraint=0, exactly as issued by this application.
			ca = bytes.Equal(ext.Value, []byte{0x30, 6, 1, 1, 0xff, 2, 1, 0})
		}
		if ext.Critical && ext.Id.Equal(asn1.ObjectIdentifier{2, 5, 29, 30}) {
			legacy = bytes.Equal(ext.Value, legacyNameConstraints)
		}
	}
	return ca && legacy
}

// The earlier certificate permitted IPv4 127.0.0.1/32 and excluded DNS ".".
var legacyNameConstraints = []byte{0x30, 0x15, 0xa0, 0x0c, 0x30, 0x0a, 0x87, 0x08, 127, 0, 0, 1, 255, 255, 255, 255, 0xa1, 0x05, 0x30, 0x03, 0x82, 0x01, '.'}
