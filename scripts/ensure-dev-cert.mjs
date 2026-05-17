import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const certDir = resolve(repoRoot, ".certs");
const caKeyPath = resolve(certDir, "mind-atlas-dev-ca.key");
const caCertPath = resolve(certDir, "mind-atlas-dev-ca.crt");
const serverKeyPath = resolve(certDir, "mind-atlas-dev-server.key");
const serverCsrPath = resolve(certDir, "mind-atlas-dev-server.csr");
const serverCertPath = resolve(certDir, "mind-atlas-dev-server.crt");
const opensslConfigPath = resolve(certDir, "mind-atlas-dev-openssl.cnf");
const sanStampPath = resolve(certDir, "mind-atlas-dev-san.txt");

mkdirSync(certDir, { recursive: true });

const sanEntries = buildSanEntries();
const sanStamp = sanEntries.join("\n");
const currentStamp = existsSync(sanStampPath) ? readFileSync(sanStampPath, "utf8") : "";
writeFileSync(opensslConfigPath, createOpenSslConfig(sanEntries), "utf8");

ensureOpenSsl();
if (!existsSync(caKeyPath) || !existsSync(caCertPath)) {
  run("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-sha256",
    "-days",
    "3650",
    "-nodes",
    "-keyout",
    caKeyPath,
    "-out",
    caCertPath,
    "-subj",
    "/CN=Mind Atlas Local Dev CA",
    "-config",
    opensslConfigPath,
    "-extensions",
    "v3_ca",
  ]);
}

if (!existsSync(serverKeyPath) || !existsSync(serverCertPath) || currentStamp !== sanStamp) {
  run("openssl", [
    "req",
    "-new",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    serverKeyPath,
    "-out",
    serverCsrPath,
    "-config",
    opensslConfigPath,
  ]);
  run("openssl", [
    "x509",
    "-req",
    "-in",
    serverCsrPath,
    "-CA",
    caCertPath,
    "-CAkey",
    caKeyPath,
    "-CAcreateserial",
    "-out",
    serverCertPath,
    "-days",
    "825",
    "-sha256",
    "-extfile",
    opensslConfigPath,
    "-extensions",
    "v3_req",
  ]);
  writeFileSync(sanStampPath, sanStamp, "utf8");
}

console.log(`Dev HTTPS certificate ready: ${serverCertPath}`);
console.log(`Install this CA on mobile devices if needed: ${caCertPath}`);

function buildSanEntries() {
  const entries = new Set(["DNS:localhost", "IP:127.0.0.1", "IP:::1"]);
  for (const item of Object.values(networkInterfaces()).flatMap((items) => items ?? [])) {
    if (item.family !== "IPv4" || item.internal || item.address.startsWith("169.254.")) continue;
    entries.add(`IP:${item.address}`);
  }
  return [...entries];
}

function createOpenSslConfig(entries) {
  const altNames = entries
    .map((entry, index) => {
      const separator = entry.indexOf(":");
      const kind = entry.slice(0, separator);
      const value = entry.slice(separator + 1);
      return `${kind}.${index + 1} = ${value}`;
    })
    .join("\n");

  return [
    "[req]",
    "default_bits = 2048",
    "prompt = no",
    "default_md = sha256",
    "distinguished_name = dn",
    "req_extensions = v3_req",
    "",
    "[dn]",
    "CN = Mind Atlas Local Dev",
    "",
    "[v3_req]",
    "basicConstraints = CA:FALSE",
    "keyUsage = digitalSignature, keyEncipherment",
    "extendedKeyUsage = serverAuth",
    "subjectAltName = @alt_names",
    "",
    "[v3_ca]",
    "basicConstraints = critical, CA:TRUE",
    "keyUsage = critical, keyCertSign, cRLSign",
    "subjectKeyIdentifier = hash",
    "",
    "[alt_names]",
    altNames,
    "",
  ].join("\n");
}

function ensureOpenSsl() {
  const result = spawnSync("openssl", ["version"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error("OpenSSL is required to generate Mind Atlas LAN HTTPS certificates.");
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}
