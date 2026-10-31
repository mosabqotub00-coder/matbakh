import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

const INSTALLATION_KEY = "matbakh.native.installation-id.v1";

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Stable per-installation identifier; it is not a login credential or staff identity. */
export async function getInstallationId() {
  const saved = await SecureStore.getItemAsync(INSTALLATION_KEY);
  if (saved) return saved;

  const bytes = await Crypto.getRandomBytesAsync(20);
  const installationId = `mbx_${hex(bytes)}`;
  await SecureStore.setItemAsync(INSTALLATION_KEY, installationId, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return installationId;
}
