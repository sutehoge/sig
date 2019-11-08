import { mnemonicToSeedSync } from 'bip39';

import {
    BIP32Interface,
    fromSeed
} from 'bip32';

import {
    encode as bech32Encode,
    toWords as bech32ToWords
} from 'bech32';

import createHash from 'create-hash';

import {
    publicKeyCreate as secp256k1PublicKeyCreate,
    sign as secp256k1Sign,
    verify as secp256k1Verify
} from 'secp256k1';

import {
    Bech32String,
    BroadcastMode,
    BroadcastTx,
    Bytes,
    KeyPair,
    StdSignature,
    StdSignMsg,
    StdTx,
    Tx,
    SignMeta,
    Wallet
} from './types';

export * from './types';

import {
    base64ToBytes,
    bytesToBase64,
    toCanonicalJSONBytes
} from './util';

export * from './util';

/**
 * Bech32 prefix for Cosmos addresses.
 */
export const COSMOS_PREFIX = 'cosmos';

/**
 * BIP32 derivation path for Cosmos keys.
 */
// @formatter:off
export const COSMOS_PATH = "m/44'/118'/0'/0/0";
// @formatter:on

/**
 * Defines a transaction broadcast mode where the client returns immediately.
 */
export const BROADCAST_MODE_SYNC = 'sync';

/**
 * Defines a transaction broadcast mode where the client waits for a `CheckTx` execution response only.
 */
export const BROADCAST_MODE_ASYNC = 'async';

/**
 * Defines a transaction broadcast mode where the client waits for the transaction to be committed in a block.
 */
export const BROADCAST_MODE_BLOCK = 'block';

/**
 * Create a {@link Wallet|`Wallet`} from a known mnemonic.
 *
 * @param   mnemonic - BIP39 mnemonic seed
 * @param   prefix   - Bech32 human readable part, defaulting to {@link COSMOS_PREFIX|`COSMOS_PREFIX`}
 * @param   path     - BIP32 derivation path, defaulting to {@link COSMOS_PATH|`COSMOS_PATH`}
 *
 * @returns a keypair and address derived from the provided mnemonic
 * @throws  will throw if the provided mnemonic is invalid
 */
export function createWalletFromMnemonic (mnemonic: string, prefix: string = COSMOS_PREFIX, path: string = COSMOS_PATH): Wallet {
    const masterKey = createMasterKeyFromMnemonic(mnemonic);

    return createWalletFromMasterKey(masterKey, prefix, path);
}

/**
 * Derive a BIP32 master key from a mnemonic.
 *
 * @param   mnemonic - BIP39 mnemonic seed
 *
 * @returns BIP32 master key
 * @throws  will throw if the provided mnemonic is invalid
 */
export function createMasterKeyFromMnemonic (mnemonic: string): BIP32Interface {
    const seed = mnemonicToSeedSync(mnemonic);

    return fromSeed(seed);
}

/**
 * Create a {@link Wallet|`Wallet`} from a BIP32 master key.
 *
 * @param   masterKey - BIP32 master key
 * @param   prefix    - Bech32 human readable part, defaulting to {@link COSMOS_PREFIX|`COSMOS_PREFIX`}
 * @param   path      - BIP32 derivation path, defaulting to {@link COSMOS_PATH|`COSMOS_PATH`}
 *
 * @returns a keypair and address derived from the provided master key
 */
export function createWalletFromMasterKey (masterKey: BIP32Interface, prefix: string = COSMOS_PREFIX, path: string = COSMOS_PATH): Wallet {
    const { privateKey, publicKey } = createKeyPairFromMasterKey(masterKey, path);

    const address = createAddress(publicKey, prefix);

    return {
        address,
        privateKey,
        publicKey
    };
}

/**
 * Derive a keypair from a BIP32 master key.
 *
 * @param   masterKey - BIP32 master key
 * @param   path      - BIP32 derivation path, defaulting to {@link COSMOS_PATH|`COSMOS_PATH`}
 *
 * @returns derived public and private key pair
 * @throws  will throw if a private key cannot be derived
 */
export function createKeyPairFromMasterKey (masterKey: BIP32Interface, path: string = COSMOS_PATH): KeyPair {
    const { privateKey } = masterKey.derivePath(path);
    if (!privateKey) {
        throw new Error('could not derive private key');
    }

    const publicKey = secp256k1PublicKeyCreate(privateKey, true);

    return {
        privateKey,
        publicKey
    };
}

/**
 * Derive a Bech32 address from a public key.
 *
 * @param   publicKey - public key bytes
 * @param   prefix    - Bech32 human readable part, defaulting to {@link COSMOS_PREFIX|`COSMOS_PREFIX`}
 *
 * @returns Bech32-encoded address
 */
export function createAddress (publicKey: Bytes, prefix: string = COSMOS_PREFIX): Bech32String {
    const hash1 = createHash('sha256').update(publicKey).digest();
    const hash2 = createHash('ripemd160').update(hash1).digest();
    const words = bech32ToWords(hash2);

    return bech32Encode(prefix, words);
}

/**
 * Sign a transaction.
 *
 * This combines the {@link Tx|`Tx`} and {@link SignMeta|`SignMeta`} into a {@link StdSignMsg|`StdSignMsg`}, signs it,
 * and attaches the signature to the transaction. If the transaction is already signed, the signature will be
 * added to the existing signatures.
 *
 * @param   tx      - transaction (signed or unsigned)
 * @param   meta    - metadata for signing
 * @param   keyPair - public and private key pair (or {@link Wallet|`Wallet`})
 *
 * @returns a signed transaction
 */
export function signTx (tx: Tx | StdTx, meta: SignMeta, keyPair: KeyPair): StdTx {
    const signMsg    = createSignMsg(tx, meta);
    const signature  = createSignature(signMsg, keyPair);
    const signatures = ('signatures' in tx) ? [...tx.signatures, signature] : [signature];

    return {
        ...tx,
        signatures
    };
}

/**
 * Create a transaction with metadata for signing.
 *
 * @param   tx   - unsigned transaction
 * @param   meta - metadata for signing
 *
 * @returns
 */
export function createSignMsg (tx: Tx, meta: SignMeta): StdSignMsg {
    return {
        account_number: meta.account_number,
        chain_id:       meta.chain_id,
        fee:            tx.fee,
        memo:           tx.memo,
        msgs:           tx.msg,
        sequence:       meta.sequence
    };
}

/**
 * Create a signature from a {@link StdSignMsg|`StdSignMsg`}.
 *
 * @param   signMsg - transaction with metadata for signing
 * @param   keyPair - public and private key pair (or {@link Wallet|`Wallet`})
 *
 * @returns a signature and corresponding public key
 */
export function createSignature (signMsg: StdSignMsg, { privateKey, publicKey }: KeyPair): StdSignature {
    const signatureBytes = createSignatureBytes(signMsg, privateKey);

    return {
        signature: bytesToBase64(signatureBytes),
        pub_key:   {
            type:  'tendermint/PubKeySecp256k1',
            value: bytesToBase64(publicKey)
        }
    };
}

/**
 * Create signature bytes from a {@link StdSignMsg|`StdSignMsg`}.
 *
 * @param   signMsg    - transaction with metadata for signing
 * @param   privateKey - private key bytes
 *
 * @returns signature bytes
 */
export function createSignatureBytes (signMsg: StdSignMsg, privateKey: Bytes): Bytes {
    const bytes = toCanonicalJSONBytes(signMsg);

    return sign(bytes, privateKey);
}

/**
 * Sign the sha256 hash of `bytes` with a secp256k1 private key.
 *
 * @param   bytes      - bytes to hash and sign
 * @param   privateKey - private key bytes
 *
 * @returns signed hash of the bytes
 * @throws  will throw if the provided private key is invalid
 */
export function sign (bytes: Bytes, privateKey: Bytes): Bytes {
    const hash = createHash('sha256').update(bytes).digest();

    const { signature } = secp256k1Sign(hash, Buffer.from(privateKey));

    return signature;
}

/**
 * Verify a signed transaction's signatures.
 *
 * @param   tx   - signed transaction
 * @param   meta - metadata for signing
 *
 * @returns `true` if all signatures are valid and match, `false` otherwise or if no signatures were provided
 */
export function verifyTx (tx: StdTx, meta: SignMeta): boolean {
    const signMsg = createSignMsg(tx, meta);

    return verifySignatures(signMsg, tx.signatures);
}

/**
 * Verify a {@link StdSignMsg|`StdSignMsg`} against multiple {@link StdSignature|`StdSignature`}s.
 *
 * @param   signMsg    - transaction with metadata for signing
 * @param   signatures - signatures
 *
 * @returns `true` if all signatures are valid and match, `false` otherwise or if no signatures were provided
 */
export function verifySignatures (signMsg: StdSignMsg, signatures: StdSignature[]): boolean {
    if (signatures.length > 0) {
        return signatures.every(function (signature: StdSignature): boolean {
            return verifySignature(signMsg, signature);
        });
    }
    else {
        return false;
    }
}

/**
 * Verify a {@link StdSignMsg|`StdSignMsg`} against a {@link StdSignature|`StdSignature`}.
 *
 * @param   signMsg   - transaction with metadata for signing
 * @param   signature - signature
 *
 * @returns `true` if the signature is valid and matches, `false` otherwise
 */
export function verifySignature (signMsg: StdSignMsg, signature: StdSignature): boolean {
    const signatureBytes = base64ToBytes(signature.signature);
    const publicKey      = base64ToBytes(signature.pub_key.value);

    return verifySignatureBytes(signMsg, signatureBytes, publicKey);
}

/**
 * Verify a signature against a {@link StdSignMsg|`StdSignMsg`}.
 *
 * @param   signMsg   - transaction with metadata for signing
 * @param   signature - signature bytes
 * @param   publicKey - public key bytes
 *
 * @returns `true` if the signature is valid and matches, `false` otherwise
 */
export function verifySignatureBytes (signMsg: StdSignMsg, signature: Bytes, publicKey: Bytes): boolean {
    const bytes = toCanonicalJSONBytes(signMsg);
    const hash  = createHash('sha256').update(bytes).digest();

    return secp256k1Verify(hash, Buffer.from(signature), Buffer.from(publicKey));
}

/**
 * Prepare a signed transaction for broadcast.
 *
 * @param   tx   - signed transaction
 * @param   mode - broadcast mode
 *
 * @returns a transaction broadcast
 */
export function createBroadcastTx (tx: StdTx, mode: BroadcastMode = BROADCAST_MODE_SYNC): BroadcastTx {
    return {
        tx,
        mode
    };
}
