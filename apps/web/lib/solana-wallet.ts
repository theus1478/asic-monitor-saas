import { createHmac } from "node:crypto";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  TokenAccountNotFoundError,
} from "@solana/spl-token";
import bs58 from "bs58";
import { BILLING_WALLET_PUBLIC_KEY, SOLANA_USDT_MINT } from "./pricing";

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente ${name} não configurada.`);
  return value;
}

/**
 * Deriva o par de chaves de uma fatura sob demanda, a partir de uma semente
 * mestra que nunca sai do servidor. Nenhuma chave privada é gravada em banco:
 * o endereço de depósito (chave pública) é o único dado persistido, e a
 * chave privada é recalculada aqui sempre que precisa varrer os fundos.
 */
export function deriveInvoiceKeypair(reference: string): Keypair {
  const seed = requireEnv("INVOICE_DERIVATION_SEED");
  const digest = createHmac("sha512", seed).update(reference).digest();
  return Keypair.fromSeed(digest.subarray(0, 32));
}

/** Carteira dedicada e de baixo valor que só paga a taxa das transações de varredura. */
function getFeePayerKeypair(): Keypair {
  const secret = requireEnv("FEE_PAYER_SECRET_KEY");
  return Keypair.fromSecretKey(bs58.decode(secret));
}

export function getConnection() {
  return new Connection(process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com", "confirmed");
}

/**
 * Move o saldo de USDT recebido no endereço da fatura para a carteira de
 * tesouraria. A carteira de tesouraria nunca precisa de chave privada no
 * servidor: quem assina é o par derivado da fatura (dono do token account de
 * origem) e a carteira de combustível (paga a taxa da rede).
 */
export async function sweepInvoiceFunds(reference: string): Promise<{ signature: string; amount: number } | null> {
  const connection = getConnection();
  const invoiceKeypair = deriveInvoiceKeypair(reference);
  const feePayer = getFeePayerKeypair();
  const mint = new PublicKey(SOLANA_USDT_MINT);
  const treasury = new PublicKey(BILLING_WALLET_PUBLIC_KEY);

  const sourceAta = getAssociatedTokenAddressSync(mint, invoiceKeypair.publicKey);
  const destinationAta = getAssociatedTokenAddressSync(mint, treasury);

  let sourceAccount;
  try {
    sourceAccount = await getAccount(connection, sourceAta, "confirmed");
  } catch (error) {
    if (error instanceof TokenAccountNotFoundError) return null;
    throw error;
  }
  if (sourceAccount.amount <= 0n) return null;

  const transaction = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(feePayer.publicKey, destinationAta, treasury, mint),
    createTransferInstruction(sourceAta, destinationAta, invoiceKeypair.publicKey, sourceAccount.amount),
  );
  transaction.feePayer = feePayer.publicKey;

  const signature = await sendAndConfirmTransaction(connection, transaction, [feePayer, invoiceKeypair], {
    commitment: "confirmed",
  });

  // USDT na Solana sempre usa 6 casas decimais (mesma convenção do resto do código, ver lib/pricing.ts).
  return { signature, amount: Number(sourceAccount.amount) / 1_000_000 };
}
