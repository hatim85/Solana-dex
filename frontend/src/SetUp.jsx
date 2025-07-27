import React, { useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import {
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  getAssociatedTokenAddress,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from '@solana/web3.js';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  createV1,
  findMetadataPda,
  mplTokenMetadata,
  TokenStandard,
  MPL_TOKEN_METADATA_PROGRAM_ID,
} from '@metaplex-foundation/mpl-token-metadata';
import { percentAmount, publicKey as umiPublicKey, signerIdentity } from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { PinataSDK } from 'pinata';

const pinata = new PinataSDK({
  pinataJwt: import.meta.env.VITE_PINATA_JWT,
  pinataGateway: import.meta.env.VITE_GATEWAY_URL,
});

export const Setup = () => {
  const { publicKey, wallet } = useWallet();
  const { connection } = useConnection();
  const [tokenAAmount, setTokenAAmount] = useState('');
  const [tokenBAmount, setTokenBAmount] = useState('');
  const [tokenAName, setTokenAName] = useState('');
  const [tokenBName, setTokenBName] = useState('');
  const [tokenASymbol, setTokenASymbol] = useState('');
  const [tokenBSymbol, setTokenBSymbol] = useState('');
  const [tokenAFile, setTokenAFile] = useState(null);
  const [tokenBFile, setTokenBFile] = useState(null);
  const [status, setStatus] = useState('');
  const [tokenAMint, setTokenAMint] = useState('');
  const [tokenBMint, setTokenBMint] = useState('');
  const [tokenAAccount, setTokenAAccount] = useState('');
  const [tokenBAccount, setTokenBAccount] = useState('');

  const validatePublicKey = (key, context) => {
    try {
      new PublicKey(key);
      return true;
    } catch (error) {
      console.error(`Invalid public key in ${context}:`, { key, error });
      return false;
    }
  };

  const uploadToPinata = async (file) => {
    if (!file) throw new Error('No file provided for upload');
    const pinataJwt = import.meta.env.VITE_PINATA_JWT;
    const gatewayUrl = import.meta.env.VITE_GATEWAY_URL;
    console.log('Pinata configuration:', { pinataJwt: !!pinataJwt, gatewayUrl });
    if (!pinataJwt || !gatewayUrl) {
      throw new Error('Pinata JWT or Gateway URL not configured in environment variables');
    }
    try {
      const upload = await pinata.upload.public.file(file);
      console.log('Pinata upload response:', { cid: upload.cid });
      if (!upload.cid) {
        throw new Error('Upload failed: No CID returned');
      }
      const ipfsLink = await pinata.gateways.public.convert(upload.cid);
      console.log('Converted IPFS link:', ipfsLink);
      return ipfsLink;
    } catch (error) {
      console.error('Pinata upload failed:', error);
      throw new Error(`Failed to upload to Pinata: ${error.message || 'Unknown error'}`);
    }
  };

  const estimateTransactionSize = (transaction) => {
    try {
      const message = transaction.serializeMessage();
      return message.length;
    } catch (error) {
      console.error('Error estimating transaction size:', error);
      return 0;
    }
  };

  const sendTransactionWithConfirmation = async (transaction, signers, blockhash, lastValidBlockHeight) => {
    transaction.feePayer = publicKey;
    transaction.recentBlockhash = blockhash;
    transaction.lastValidBlockHeight = lastValidBlockHeight;
    const signature = await wallet.adapter.sendTransaction(transaction, connection, { signers });
    console.log('Transaction sent', { signature });
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
    console.log('Transaction confirmed', { signature });
    return signature;
  };

  const handleSetup = async () => {
    console.log('handleSetup started', { publicKey: publicKey?.toBase58(), wallet: !!wallet, adapter: !!wallet?.adapter });

    if (!publicKey || !wallet || !wallet.adapter) {
      setStatus('Please connect your wallet.');
      console.log('Wallet not connected, exiting');
      return;
    }

    try {
      setStatus('Uploading images to IPFS and creating tokens...');
      console.log('Starting token creation process...');

      // Hardcode decimals to 9
      const decimalsA = 9;
      const decimalsB = 9;
      const amountA = parseFloat(tokenAAmount);
      const amountB = parseFloat(tokenBAmount);
      console.log('Input values', { decimalsA, decimalsB, amountA, amountB, tokenAName, tokenBName, tokenASymbol, tokenBSymbol });

      // Validate inputs
      if (isNaN(amountA) || isNaN(amountB) || amountA <= 0 || amountB <= 0) {
        setStatus('Invalid token amounts provided. Amounts must be positive numbers.');
        console.log('Invalid amounts', { amountA, amountB });
        return;
      }
      if (!tokenAName || !tokenBName || !tokenASymbol || !tokenBSymbol) {
        setStatus('All token name and symbol fields must be filled.');
        console.log('Missing metadata inputs', { tokenAName, tokenBName, tokenASymbol, tokenBSymbol });
        return;
      }
      if (!tokenAFile || !tokenBFile) {
        setStatus('Please upload images for both tokens.');
        console.log('Missing image files', { tokenAFile, tokenBFile });
        return;
      }
      const validImageTypes = ['image/jpeg', 'image/png', 'image/gif'];
      if (!validImageTypes.includes(tokenAFile.type) || !validImageTypes.includes(tokenBFile.type)) {
        setStatus('Invalid image file type. Only JPEG, PNG, and GIF are supported.');
        console.log('Invalid image types', { tokenAFileType: tokenAFile.type, tokenBFileType: tokenBFile.type });
        return;
      }

      // Upload images to Pinata
      setStatus('Uploading Token A image to IPFS...');
      const tokenAUri = await uploadToPinata(tokenAFile);
      console.log('Token A image uploaded', { tokenAUri });
      setStatus('Uploading Token B image to IPFS...');
      const tokenBUri = await uploadToPinata(tokenBFile);
      console.log('Token B image uploaded', { tokenBUri });

      // Check SOL balance
      console.log('Checking wallet SOL balance...');
      const balance = await connection.getBalance(publicKey);
      console.log('Wallet SOL balance', { balance: balance / LAMPORTS_PER_SOL });
      const minSolRequired = 0.015 * LAMPORTS_PER_SOL;
      if (balance < minSolRequired) {
        setStatus(`Insufficient SOL balance. Need at least ${minSolRequired / LAMPORTS_PER_SOL} SOL.`);
        console.log('Insufficient SOL balance', { balance: balance / LAMPORTS_PER_SOL });
        return;
      }

      // Initialize umi
      const umi = createUmi(connection.rpcEndpoint).use(mplTokenMetadata());
      umi.use(signerIdentity({
        publicKey: umiPublicKey(publicKey.toBase58()),
        signTransaction: async (tx) => {
          console.log('signTransaction called with tx:', JSON.stringify(tx, (key, value) => {
            if (value instanceof Uint8Array) return Array.from(value);
            return value;
          }, 2));
          const instructions = tx.message?.instructions || tx.instructions;
          if (!instructions || !Array.isArray(instructions) || instructions.length === 0) {
            console.error('Invalid transaction: instructions are undefined, not an array, or empty', { tx });
            throw new Error('Invalid transaction: no instructions provided');
          }
          const transaction = new Transaction();
          for (const ix of instructions) {
            let keys = ix.keys;
            if (!keys || !Array.isArray(keys)) {
              console.warn('Instruction missing keys, constructing from accountIndexes', { ix });
              if (!ix.accountIndexes || !Array.isArray(ix.accountIndexes)) {
                console.error('Invalid instruction: no keys or accountIndexes provided', { ix });
                throw new Error('Invalid instruction: no keys or accountIndexes provided');
              }
              keys = ix.accountIndexes.map((index, i) => {
                let pubkey = tx.message.accounts[index];
                if (pubkey === 'Sysvar1nstructions1111111111111111111111111') {
                  console.warn('Correcting SysvarInstructions public key');
                  pubkey = SYSVAR_INSTRUCTIONS_PUBKEY.toBase58();
                }
                if (!validatePublicKey(pubkey, 'signTransaction keys construction')) {
                  throw new Error(`Invalid public key at index ${index}: ${pubkey}`);
                }
                return {
                  pubkey,
                  isSigner: i === 3 || i === 4 || i === 5 || i === 8 || i === 9 || i === 10,
                  isWritable: i === 0 || i === 2 || i === 6 || i === 7,
                };
              });
            }
            const programPubkey = tx.message.accounts[ix.programIndex];
            if (!validatePublicKey(programPubkey, 'signTransaction program key')) {
              throw new Error(`Invalid program public key at index ${ix.programIndex}: ${programPubkey}`);
            }
            transaction.add({
              keys: keys.map((key) => ({
                pubkey: new PublicKey(key.pubkey),
                isSigner: key.isSigner,
                isWritable: key.isWritable,
              })),
              programId: new PublicKey(programPubkey),
              data: Buffer.from(ix.data),
            });
          }
          transaction.feePayer = publicKey;
          const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
          transaction.recentBlockhash = blockhash;
          transaction.lastValidBlockHeight = lastValidBlockHeight;
          console.log('Signing transaction with blockhash:', blockhash);
          try {
            const signature = await wallet.adapter.sendTransaction(transaction, connection);
            console.log('Transaction signed and sent', { signature });
            return base58.serialize(signature);
          } catch (signError) {
            console.error('Error signing transaction:', signError);
            throw new Error(`Failed to sign transaction: ${signError.message || 'Unknown error'}`);
          }
        },
      }));

      // Verify umi configuration
      if (!umi.programs.get('mplTokenMetadata')) {
        throw new Error('mplTokenMetadata plugin not registered with umi');
      }

      // Create keypairs for mints
      console.log('Creating Token A mint...');
      const tokenAMintKeypair = Keypair.generate();
      console.log('Token A mint keypair generated', { tokenAMintKeypair: tokenAMintKeypair.publicKey.toBase58() });
      console.log('Creating Token B mint...');
      const tokenBMintKeypair = Keypair.generate();
      console.log('Token B mint keypair generated', { tokenBMintKeypair: tokenBMintKeypair.publicKey.toBase58() });

      // Validate mint public keys
      if (!tokenAMintKeypair.publicKey || !tokenBMintKeypair.publicKey) {
        throw new Error('Failed to generate valid mint keypairs');
      }

      // Get rent exemption
      const rentExemptLamports = await getMinimumBalanceForRentExemptMint(connection);

      // Prepare transactions
      let { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      const transactionA = new Transaction();
      const transactionB = new Transaction();
      let useSingleTransaction = true;

      // Token A Mint
      transactionA.add(
        SystemProgram.createAccount({
          fromPubkey: publicKey,
          newAccountPubkey: tokenAMintKeypair.publicKey,
          space: MINT_SIZE,
          lamports: rentExemptLamports,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
          tokenAMintKeypair.publicKey,
          decimalsA,
          publicKey,
          null,
          TOKEN_PROGRAM_ID
        )
      );

      // Token A ATA
      const tokenAATA = await getAssociatedTokenAddress(
        tokenAMintKeypair.publicKey,
        publicKey,
        false,
        TOKEN_PROGRAM_ID
      );
      console.log('Derived Token A ATA address:', tokenAATA.toBase58());
      const tokenAAccountInfo = await connection.getAccountInfo(tokenAATA);
      if (!tokenAAccountInfo) {
        console.log('Token A ATA does not exist, creating it...');
        transactionA.add(
          createAssociatedTokenAccountInstruction(
            publicKey,
            tokenAATA,
            publicKey,
            tokenAMintKeypair.publicKey,
            TOKEN_PROGRAM_ID
          )
        );
      } else {
        console.log('Token A ATA already exists:', tokenAATA.toBase58());
      }

      // Token A Metadata
      let tokenAMetadataPDA;
      try {
        const tokenAMintUmi = umiPublicKey(tokenAMintKeypair.publicKey.toBase58());
        console.log('Token A mint for PDA:', tokenAMintUmi.toString());
        const tokenAMetadataPdaArray = findMetadataPda(umi, { mint: tokenAMintUmi });
        console.log('Token A metadata PDA raw output:', tokenAMetadataPdaArray);
        if (!Array.isArray(tokenAMetadataPdaArray) || tokenAMetadataPdaArray.length === 0) {
          const [pda] = await PublicKey.findProgramAddress(
            [
              Buffer.from('metadata'),
              new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID).toBuffer(),
              tokenAMintKeypair.publicKey.toBuffer(),
            ],
            new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID)
          );
          tokenAMetadataPDA = umiPublicKey(pda.toBase58());
          console.log('Token A metadata PDA (fallback):', tokenAMetadataPDA.toString());
        } else {
          tokenAMetadataPDA = tokenAMetadataPdaArray[0];
          console.log('Token A metadata PDA:', tokenAMetadataPDA.toString());
        }
      } catch (pdaError) {
        console.error('Error deriving Token A metadata PDA:', pdaError);
        throw new Error(`Failed to derive Token A metadata PDA: ${pdaError.message}`);
      }
      let tokenAMetadataBuilder = createV1(umi, {
        mint: umiPublicKey(tokenAMintKeypair.publicKey.toBase58()),
        authority: umi.identity,
        payer: umi.identity,
        updateAuthority: umi.identity,
        name: tokenAName,
        symbol: tokenASymbol,
        uri: tokenAUri,
        sellerFeeBasisPoints: percentAmount(0),
        tokenStandard: TokenStandard.Fungible,
      });
      console.log('Token A metadata builder:', JSON.stringify(tokenAMetadataBuilder, null, 2));
      let tokenAMetadataTx;
      let buildAttempts = 0;
      const maxBuildAttempts = 3;
      while (buildAttempts < maxBuildAttempts) {
        try {
          buildAttempts++;
          tokenAMetadataTx = await tokenAMetadataBuilder.setBlockhash(blockhash).build(umi);
          console.log('Token A metadata transaction built (attempt ' + buildAttempts + '):', JSON.stringify(tokenAMetadataTx, (key, value) => {
            if (value instanceof Uint8Array) return Array.from(value);
            return value;
          }, 2));
          const instructions = tokenAMetadataTx.message?.instructions || tokenAMetadataTx.instructions;
          console.log('Validating Token A metadata transaction instructions:', {
            hasInstructions: !!instructions,
            isArray: Array.isArray(instructions),
            instructionCount: instructions ? instructions.length : 0,
            instructionsExist: !!tokenAMetadataTx.instructions,
            messageInstructionsExist: !!tokenAMetadataTx.message?.instructions,
          });
          if (!instructions || !Array.isArray(instructions) || instructions.length === 0) {
            console.error('Invalid Token A metadata transaction: no instructions', { tokenAMetadataTx });
            tokenAMetadataBuilder = createV1(umi, {
              mint: umiPublicKey(tokenAMintKeypair.publicKey.toBase58()),
              authority: umi.identity,
              payer: umi.identity,
              updateAuthority: umi.identity,
              name: tokenAName,
              symbol: tokenASymbol,
              uri: tokenAUri,
              sellerFeeBasisPoints: percentAmount(0),
              tokenStandard: TokenStandard.Fungible,
            });
            throw new Error('No instructions found in transaction');
          }
          for (const ix of instructions) {
            console.log('Inspecting instruction:', { ix });
            let keys = ix.keys;
            if (!keys || !Array.isArray(keys)) {
              console.warn('Instruction missing keys, constructing from accountIndexes', { ix });
              if (!ix.accountIndexes || !Array.isArray(ix.accountIndexes)) {
                console.error('Invalid instruction: no keys or accountIndexes provided', { ix });
                throw new Error('Invalid instruction: no keys or accountIndexes provided');
              }
              keys = ix.accountIndexes.map((index, i) => {
                let pubkey = tokenAMetadataTx.message.accounts[index];
                if (pubkey === 'Sysvar1nstructions1111111111111111111111111') {
                  console.warn('Correcting SysvarInstructions public key');
                  pubkey = SYSVAR_INSTRUCTIONS_PUBKEY.toBase58();
                }
                if (!validatePublicKey(pubkey, 'Token A metadata keys construction')) {
                  throw new Error(`Invalid public key at index ${index}: ${pubkey}`);
                }
                return {
                  pubkey,
                  isSigner: i === 3 || i === 4 || i === 5,
                  isWritable: i === 0 || i === 2,
                };
              });
              ix.keys = keys;
            }
          }
          break;
        } catch (buildError) {
          console.error('Failed to build Token A metadata transaction (attempt ' + buildAttempts + '):', buildError);
          if (buildAttempts === maxBuildAttempts) {
            throw new Error(`Failed to build Token A metadata transaction after ${maxBuildAttempts} attempts: ${buildError.message}`);
          }
          const latestBlock = await connection.getLatestBlockhash('confirmed');
          blockhash = latestBlock.blockhash;
          lastValidBlockHeight = latestBlock.lastValidBlockHeight;
        }
      }
      const instructionsA = tokenAMetadataTx.message?.instructions || tokenAMetadataTx.instructions;
      for (const ix of instructionsA) {
        if (!ix.keys || !Array.isArray(ix.keys)) {
          console.error('Invalid instruction after validation: keys are undefined or not an array', { ix });
          throw new Error('Invalid instruction: no keys provided');
        }
        const programPubkey = tokenAMetadataTx.message.accounts[ix.programIndex];
        if (!validatePublicKey(programPubkey, 'Token A metadata program key')) {
          throw new Error(`Invalid program public key at index ${ix.programIndex}: ${programPubkey}`);
        }
        transactionA.add({
          keys: ix.keys.map((key) => {
            if (!validatePublicKey(key.pubkey, 'Token A metadata keys mapping')) {
              throw new Error(`Invalid public key in transaction: ${key.pubkey}`);
            }
            return {
              pubkey: new PublicKey(key.pubkey),
              isSigner: key.isSigner,
              isWritable: key.isWritable,
            };
          }),
          programId: new PublicKey(programPubkey),
          data: Buffer.from(ix.data),
        });
      }

      // Token B Mint
      transactionB.add(
        SystemProgram.createAccount({
          fromPubkey: publicKey,
          newAccountPubkey: tokenBMintKeypair.publicKey,
          space: MINT_SIZE,
          lamports: rentExemptLamports,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
          tokenBMintKeypair.publicKey,
          decimalsB,
          publicKey,
          null,
          TOKEN_PROGRAM_ID
        )
      );

      // Token B ATA
      const tokenBATA = await getAssociatedTokenAddress(
        tokenBMintKeypair.publicKey,
        publicKey,
        false,
        TOKEN_PROGRAM_ID
      );
      console.log('Derived Token B ATA address:', tokenBATA.toBase58());
      const tokenBAccountInfo = await connection.getAccountInfo(tokenBATA);
      if (!tokenBAccountInfo) {
        console.log('Token B ATA does not exist, creating it...');
        transactionB.add(
          createAssociatedTokenAccountInstruction(
            publicKey,
            tokenBATA,
            publicKey,
            tokenBMintKeypair.publicKey,
            TOKEN_PROGRAM_ID
          )
        );
      } else {
        console.log('Token B ATA already exists:', tokenBATA.toBase58());
      }

      // Token B Metadata
      let tokenBMetadataPDA;
      try {
        const tokenBMintUmi = umiPublicKey(tokenBMintKeypair.publicKey.toBase58());
        console.log('Token B mint for PDA:', tokenBMintUmi.toString());
        const tokenBMetadataPdaArray = findMetadataPda(umi, { mint: tokenBMintUmi });
        console.log('Token B metadata PDA raw output:', tokenBMetadataPdaArray);
        if (!Array.isArray(tokenBMetadataPdaArray) || tokenBMetadataPdaArray.length === 0) {
          const [pda] = await PublicKey.findProgramAddress(
            [
              Buffer.from('metadata'),
              new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID).toBuffer(),
              tokenBMintKeypair.publicKey.toBuffer(),
            ],
            new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID)
          );
          tokenBMetadataPDA = umiPublicKey(pda.toBase58());
          console.log('Token B metadata PDA (fallback):', tokenBMetadataPDA.toString());
        } else {
          tokenBMetadataPDA = tokenBMetadataPdaArray[0];
          console.log('Token B metadata PDA:', tokenBMetadataPDA.toString());
        }
      } catch (pdaError) {
        console.error('Error deriving Token B metadata PDA:', pdaError);
        throw new Error(`Failed to derive Token B metadata PDA: ${pdaError.message}`);
      }
      let tokenBMetadataBuilder = createV1(umi, {
        mint: umiPublicKey(tokenBMintKeypair.publicKey.toBase58()),
        authority: umi.identity,
        payer: umi.identity,
        updateAuthority: umi.identity,
        name: tokenBName,
        symbol: tokenBSymbol,
        uri: tokenBUri,
        sellerFeeBasisPoints: percentAmount(0),
        tokenStandard: TokenStandard.Fungible,
      });
      console.log('Token B metadata builder:', JSON.stringify(tokenBMetadataBuilder, null, 2));
      let tokenBMetadataTx;
      let buildAttemptsB = 0;
      const maxBuildAttemptsB = 3;
      while (buildAttemptsB < maxBuildAttemptsB) {
        try {
          buildAttemptsB++;
          tokenBMetadataTx = await tokenBMetadataBuilder.setBlockhash(blockhash).build(umi);
          console.log('Token B metadata transaction built (attempt ' + buildAttemptsB + '):', JSON.stringify(tokenBMetadataTx, (key, value) => {
            if (value instanceof Uint8Array) return Array.from(value);
            return value;
          }, 2));
          const instructionsB = tokenBMetadataTx.message?.instructions || tokenBMetadataTx.instructions;
          console.log('Validating Token B metadata transaction instructions:', {
            hasInstructions: !!instructionsB,
            isArray: Array.isArray(instructionsB),
            instructionCount: instructionsB ? instructionsB.length : 0,
            instructionsExist: !!tokenBMetadataTx.instructions,
            messageInstructionsExist: !!tokenBMetadataTx.message?.instructions,
          });
          if (!instructionsB || !Array.isArray(instructionsB) || instructionsB.length === 0) {
            console.error('Invalid Token B metadata transaction: no instructions', { tokenBMetadataTx });
            tokenBMetadataBuilder = createV1(umi, {
              mint: umiPublicKey(tokenBMintKeypair.publicKey.toBase58()),
              authority: umi.identity,
              payer: umi.identity,
              updateAuthority: umi.identity,
              name: tokenBName,
              symbol: tokenBSymbol,
              uri: tokenBUri,
              sellerFeeBasisPoints: percentAmount(0),
              tokenStandard: TokenStandard.Fungible,
            });
            throw new Error('No instructions found in transaction');
          }
          for (const ix of instructionsB) {
            console.log('Inspecting instruction:', { ix });
            let keys = ix.keys;
            if (!keys || !Array.isArray(keys)) {
              console.warn('Instruction missing keys, constructing from accountIndexes', { ix });
              if (!ix.accountIndexes || !Array.isArray(ix.accountIndexes)) {
                console.error('Invalid instruction: no keys or accountIndexes provided', { ix });
                throw new Error('Invalid instruction: no keys or accountIndexes provided');
              }
              keys = ix.accountIndexes.map((index, i) => {
                let pubkey = tokenBMetadataTx.message.accounts[index];
                if (pubkey === 'Sysvar1nstructions1111111111111111111111111') {
                  console.warn('Correcting SysvarInstructions public key');
                  pubkey = SYSVAR_INSTRUCTIONS_PUBKEY.toBase58();
                }
                if (!validatePublicKey(pubkey, 'Token B metadata keys construction')) {
                  throw new Error(`Invalid public key at index ${index}: ${pubkey}`);
                }
                return {
                  pubkey,
                  isSigner: i === 3 || i === 4 || i === 5,
                  isWritable: i === 0 || i === 2,
                };
              });
              ix.keys = keys;
            }
          }
          break;
        } catch (buildError) {
          console.error('Failed to build Token B metadata transaction (attempt ' + buildAttemptsB + '):', buildError);
          if (buildAttemptsB === maxBuildAttemptsB) {
            throw new Error(`Failed to build Token B metadata transaction after ${maxBuildAttemptsB} attempts: ${buildError.message}`);
          }
          const latestBlock = await connection.getLatestBlockhash('confirmed');
          blockhash = latestBlock.blockhash;
          lastValidBlockHeight = latestBlock.lastValidBlockHeight;
        }
      }
      const instructionsB = tokenBMetadataTx.message?.instructions || tokenBMetadataTx.instructions;
      for (const ix of instructionsB) {
        if (!ix.keys || !Array.isArray(ix.keys)) {
          console.error('Invalid instruction after validation: keys are undefined or not an array', { ix });
          throw new Error('Invalid instruction: no keys provided');
        }
        const programPubkey = tokenBMetadataTx.message.accounts[ix.programIndex];
        if (!validatePublicKey(programPubkey, 'Token B metadata program key')) {
          throw new Error(`Invalid program public key at index ${ix.programIndex}: ${programPubkey}`);
        }
        transactionB.add({
          keys: ix.keys.map((key) => {
            if (!validatePublicKey(key.pubkey, 'Token B metadata keys mapping')) {
              throw new Error(`Invalid public key in transaction: ${key.pubkey}`);
            }
            return {
              pubkey: new PublicKey(key.pubkey),
              isSigner: key.isSigner,
              isWritable: key.isWritable,
            };
          }),
          programId: new PublicKey(programPubkey),
          data: Buffer.from(ix.data),
        });
      }

      // Mint tokens
      const tokenAAmountBN = Math.floor(amountA * 10 ** decimalsA);
      const tokenBAmountBN = Math.floor(amountB * 10 ** decimalsB);
      console.log('Minting tokens:', { tokenAAmountBN, tokenBAmountBN });

      transactionA.add(
        createMintToInstruction(
          tokenAMintKeypair.publicKey,
          tokenAATA,
          publicKey,
          tokenAAmountBN,
          [],
          TOKEN_PROGRAM_ID
        )
      );

      transactionB.add(
        createMintToInstruction(
          tokenBMintKeypair.publicKey,
          tokenBATA,
          publicKey,
          tokenBAmountBN,
          [],
          TOKEN_PROGRAM_ID
        )
      );

      // Try single transaction
      const combinedTransaction = new Transaction();
      combinedTransaction.instructions = [...transactionA.instructions, ...transactionB.instructions];
      combinedTransaction.feePayer = publicKey;
      combinedTransaction.recentBlockhash = blockhash;
      combinedTransaction.lastValidBlockHeight = lastValidBlockHeight;

      const txSize = estimateTransactionSize(combinedTransaction);
      console.log('Estimated transaction size:', txSize, 'bytes');

      if (txSize > 1232) {
        console.log('Transaction size exceeds 1232 bytes, splitting into two transactions');
        useSingleTransaction = false;
      }

      if (useSingleTransaction) {
        setStatus('Sending combined transaction...');
        try {
          await sendTransactionWithConfirmation(combinedTransaction, [tokenAMintKeypair, tokenBMintKeypair], blockhash, lastValidBlockHeight);
          setStatus('Combined transaction confirmed');
        } catch (txError) {
          console.error('Combined transaction failed:', txError);
          if (txError.message && txError.message.includes('Transaction too large')) {
            console.log('Falling back to split transactions due to size limit');
            useSingleTransaction = false;
          } else {
            throw new Error(`Failed to execute combined transaction: ${txError.message || 'Transaction failed'}`);
          }
        }
      }

      if (!useSingleTransaction) {
        setStatus('Sending Token A transaction...');
        await sendTransactionWithConfirmation(transactionA, [tokenAMintKeypair], blockhash, lastValidBlockHeight);
        setStatus('Token A transaction confirmed. Sending Token B transaction...');

        // Refresh blockhash for second transaction
        ({ blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed'));
        await sendTransactionWithConfirmation(transactionB, [tokenBMintKeypair], blockhash, lastValidBlockHeight);
        setStatus('Token B transaction confirmed');
      }

      // Update state
      setTokenAMint(tokenAMintKeypair.publicKey.toBase58());
      setTokenBMint(tokenBMintKeypair.publicKey.toBase58());
      setTokenAAccount(tokenAATA.toBase58());
      setTokenBAccount(tokenBATA.toBase58());

      setStatus(
        `Success! Token A Mint: ${tokenAMintKeypair.publicKey.toBase58()}, Token A ATA: ${tokenAATA.toBase58()}, ` +
        `Token B Mint: ${tokenBMintKeypair.publicKey.toBase58()}, Token B ATA: ${tokenBATA.toBase58()}`
      );
      console.log('Setup completed successfully');
    } catch (error) {
      setStatus(`Error: ${error.message || 'An unexpected error occurred.'}`);
      console.error('Error in handleSetup:', error);
      if (error.stack) console.error('Stack trace:', error.stack);
    }
  };

  return (
    <div className="setup">
      <h2>Setup Tokens</h2>
      <h3>Token A</h3>
      <input
        type="text"
        placeholder="Token A Name"
        value={tokenAName}
        onChange={(e) => setTokenAName(e.target.value)}
      />
      <input
        type="text"
        placeholder="Token A Symbol"
        value={tokenASymbol}
        onChange={(e) => setTokenASymbol(e.target.value)}
      />
      <input
        type="file"
        accept="image/jpeg,image/png,image/gif"
        onChange={(e) => setTokenAFile(e.target.files[0])}
      />
      <input
        type="number"
        placeholder="Token A Amount to Mint"
        value={tokenAAmount}
        onChange={(e) => setTokenAAmount(e.target.value)}
        min="0"
        step="0.01"
      />
      <h3>Token B</h3>
      <input
        type="text"
        placeholder="Token B Name"
        value={tokenBName}
        onChange={(e) => setTokenBName(e.target.value)}
      />
      <input
        type="text"
        placeholder="Token B Symbol"
        value={tokenBSymbol}
        onChange={(e) => setTokenBSymbol(e.target.value)}
      />
      <input
        type="file"
        accept="image/jpeg,image/png,image/gif"
        onChange={(e) => setTokenBFile(e.target.files[0])}
      />
      <input
        type="number"
        placeholder="Token B Amount to Mint"
        value={tokenBAmount}
        onChange={(e) => setTokenBAmount(e.target.value)}
        min="0"
        step="0.01"
      />
      <button onClick={handleSetup} disabled={!publicKey || !wallet || !wallet.adapter}>
        Create Tokens and Accounts
      </button>
      {tokenAMint && (
        <p>
          Token A Mint: <code>{tokenAMint}</code>
          <br />
          Token A ATA: <code>{tokenAAccount}</code>
        </p>
      )}
      {tokenBMint && (
        <p>
          Token B Mint: <code>{tokenBMint}</code>
          <br />
          Token B ATA: <code>{tokenBAccount}</code>
        </p>
      )}
      <p>{status}</p>
    </div>
  );
};