import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { deriveKey } from "@/lib/crypto";

interface PassphraseContextValue {
  cryptoKey: CryptoKey | null;
  isUnlocked: boolean;
  unlock: (passphrase: string, salt: string) => Promise<void>;
  lock: () => void;
}

const PassphraseContext = createContext<PassphraseContextValue | null>(null);

export function PassphraseProvider({ children }: { children: ReactNode }) {
  const [cryptoKey, setCryptoKey] = useState<CryptoKey | null>(() => {
    return null;
  });

  const unlock = useCallback(async (passphrase: string, salt: string) => {
    const key = await deriveKey(passphrase, salt);
    setCryptoKey(key);
    sessionStorage.setItem("clipshare_unlocked", "1");
  }, []);

  const lock = useCallback(() => {
    setCryptoKey(null);
    sessionStorage.removeItem("clipshare_unlocked");
  }, []);

  return (
    <PassphraseContext.Provider value={{ cryptoKey, isUnlocked: cryptoKey !== null, unlock, lock }}>
      {children}
    </PassphraseContext.Provider>
  );
}

export function usePassphrase() {
  const ctx = useContext(PassphraseContext);
  if (!ctx) throw new Error("usePassphrase must be used inside PassphraseProvider");
  return ctx;
}
