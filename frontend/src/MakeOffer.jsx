import React, { useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import * as anchor from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress, getMint, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import { getAccount } from '@solana/spl-token';
import idl from './idl/swap_idl.json';
import { Plus, CheckCircle, AlertCircle, Loader, ArrowRight } from 'lucide-react';
import { token } from '@coral-xyz/anchor/dist/cjs/utils';

export const MakeOffer = () => {
  const { publicKey, wallet, signTransaction } = useWallet();
  const { connection } = useConnection();
  const [tokenAAmount, setTokenAAmount] = useState('');
  const [tokenBAmount, setTokenBAmount] = useState('');
  const [tokenMintA, setTokenMintA] = useState('');
  const [tokenMintB, setTokenMintB] = useState('');
  const [status, setStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validatePublicKey = (key, context) => {
    try {
      new PublicKey(key);
      return true;
    } catch (error) {
      console.error(`Invalid public key in ${context}:`, { key, error });
      return false;
    }
  };

  const getNextOfferId = async (maker, programId) => {
    let offerId = 0;
    while (true) {
      const offerIdBN = new anchor.BN(offerId);
      const [offerPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('offer'),
          maker.toBuffer(),
          offerIdBN.toArrayLike(Buffer, 'le', 8),
        ],
        programId
      );
      const accountInfo = await connection.getAccountInfo(offerPda);
      if (!accountInfo) {
        return offerIdBN;
      }
      offerId++;
    }
  };

  const handleMakeOffer = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    if (!publicKey || !wallet || !signTransaction) {
      setStatus('Please connect your wallet.');
      setIsSubmitting(false);
      return;
    }

    try {
      setStatus('Creating offer...');

      // Validate inputs
      const tokenAAmountNum = parseFloat(tokenAAmount);
      const tokenBAmountNum = parseFloat(tokenBAmount);

      if (isNaN(tokenAAmountNum) || tokenAAmountNum <= 0) {
        setStatus('Invalid Token A amount. Must be a positive number.');
        setIsSubmitting(false);
        return;
      }
      if (isNaN(tokenBAmountNum) || tokenBAmountNum <= 0) {
        setStatus('Invalid Token B amount. Must be a positive number.');
        setIsSubmitting(false);
        return;
      }
      if (!validatePublicKey(tokenMintA, 'Token A Mint')) {
        setStatus('Invalid Token A Mint address.');
        setIsSubmitting(false);
        return;
      }
      if (!validatePublicKey(tokenMintB, 'Token B Mint')) {
        setStatus('Invalid Token B Mint address.');
        setIsSubmitting(false);
        return;
      }

      // Fetch token decimals
      let tokenADecimals = 9;
      let tokenBDecimals = 9;
      try {
        const mintAInfo = await getMint(connection, new PublicKey(tokenMintA));
        tokenADecimals = mintAInfo.decimals;
        const mintBInfo = await getMint(connection, new PublicKey(tokenMintB));
        tokenBDecimals = mintBInfo.decimals;
      } catch (error) {
        setStatus('Error fetching token decimals. Using default decimals.');
        console.error('Error fetching mint info:', error);
      }

      // Convert inputs with correct decimals
      const tokenAAmountBN = new anchor.BN(tokenAAmountNum * 10 ** tokenADecimals);
      const tokenBWantedAmountBN = new anchor.BN(tokenBAmountNum * 10 ** tokenBDecimals);
      console.log('Offer Input Values:', {
        tokenAAmountNum,
        tokenADecimals,
        tokenAAmountBN: tokenAAmountBN.toString(),
        tokenBAmountNum,
        tokenBDecimals,
        tokenBWantedAmountBN: tokenBWantedAmountBN.toString(),
      });

      const programId = new PublicKey(idl.address);
      const offerIdBN = await getNextOfferId(publicKey, programId);
      // Derive Maker Token A Account
      const [offerPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('offer'),
          publicKey.toBuffer(),
          offerIdBN.toArrayLike(Buffer, 'le', 8),
        ],
        programId
      );
      const makerTokenAccountA = await getAssociatedTokenAddress(
        new PublicKey(tokenMintA),
        publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      // Derive Maker Token B Account
      const makerTokenAccountB = await getAssociatedTokenAddress(
        new PublicKey(tokenMintB),
        publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      // Derive vault ATA
      const vault = await getAssociatedTokenAddress(
        new PublicKey(tokenMintA),
        offerPda,
        true,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      // Check SOL balance
      const balance = await connection.getBalance(publicKey);
      const minSolRequired = 0.005 * anchor.web3.LAMPORTS_PER_SOL;
      if (balance < minSolRequired) {
        setStatus(`Insufficient SOL balance. Need at least ${minSolRequired / anchor.web3.LAMPORTS_PER_SOL} SOL.`);
        setIsSubmitting(false);
        return;
      }

      // Verify accounts exist
      const tokenMintAInfo = await connection.getAccountInfo(new PublicKey(tokenMintA));
      if (!tokenMintAInfo) {
        setStatus('Token A Mint does not exist.');
        setIsSubmitting(false);
        return;
      }
      const tokenMintBInfo = await connection.getAccountInfo(new PublicKey(tokenMintB));
      if (!tokenMintBInfo) {
        setStatus('Token B Mint does not exist.');
        setIsSubmitting(false);
        return;
      }
      const makerTokenAccountAInfo = await connection.getAccountInfo(makerTokenAccountA);
      if (!makerTokenAccountAInfo) {
        setStatus('Maker Token A Account does not exist.');
        setIsSubmitting(false);
        return;
      }
      const makerTokenAccountBInfo = await connection.getAccountInfo(makerTokenAccountB);
      if (!makerTokenAccountBInfo) {
        setStatus('Maker Token B Account does not exist.');
        setIsSubmitting(false);
        return;
      }

      // Verify account ownership
      if (!makerTokenAccountAInfo.owner.equals(TOKEN_PROGRAM_ID)) {
        setStatus('Maker Token A Account is not owned by the Token Program.');
        setIsSubmitting(false);
        return;
      }
      if (!makerTokenAccountBInfo.owner.equals(TOKEN_PROGRAM_ID)) {
        setStatus('Maker Token B Account is not owned by the Token Program.');
        setIsSubmitting(false);
        return;
      }

      const tokenAccountAData = await getAccount(connection, makerTokenAccountA);
      if (!tokenAccountAData.mint.equals(new PublicKey(tokenMintA))) {
        setStatus('Maker Token A Account is not associated with Token A Mint.');
        setIsSubmitting(false);
        return;
      }
      const tokenAccountBData = await getAccount(connection, makerTokenAccountB);
      if (!tokenAccountBData.mint.equals(new PublicKey(tokenMintB))) {
        setStatus('Maker Token B Account is not associated with Token B Mint.');
        setIsSubmitting(false);
        return;
      }

      // Verify sufficient balance for Token A
      const tokenAAmountLamports = tokenAAmountNum * 10 ** tokenADecimals;
      if (tokenAccountAData.amount < BigInt(tokenAAmountLamports)) {
        setStatus(`Insufficient balance in Maker Token A Account. Need ${tokenAAmountNum} tokens.`);
        setIsSubmitting(false);
        return;
      }

      const provider = new anchor.AnchorProvider(connection, { publicKey, signTransaction }, { commitment: 'confirmed' });
      const program = new anchor.Program(idl, provider);

      // Create transaction (start with an empty transaction)
      const transaction = new Transaction();

      // Check if vault ATA exists, create if it doesn't
      const vaultInfo = await connection.getAccountInfo(vault);

      // if (!makerTokenAccountAInfo) {
      //   setStatus('Creating associated token account for Token A...');
      //   const ataIx = createAssociatedTokenAccountInstruction(
      //     publicKey, // payer
      //     makerTokenAccountA, // associated account to create
      //     publicKey, // owner
      //     new PublicKey(tokenMintA), // mint
      //     TOKEN_PROGRAM_ID,
      //     ASSOCIATED_TOKEN_PROGRAM_ID
      //   );
      //   const ataTx = new Transaction().add(ataIx);
      //   ataTx.feePayer = publicKey;
      //   const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      //   ataTx.recentBlockhash = blockhash;

      //   const signedAtaTx = await signTransaction(ataTx);
      //   const sig = await connection.sendRawTransaction(signedAtaTx.serialize());
      //   await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
      //   setStatus('Token A account created.');
      // }


      // Add makeOffer instruction
    const makeOfferIx = await program.methods
        .makeOffer(offerIdBN, tokenAAmountBN, tokenBWantedAmountBN)
        .accounts({
          maker: publicKey,
          tokenMintA: new PublicKey(tokenMintA),
          tokenMintB: new PublicKey(tokenMintB),
          makerTokenAccountA,
          makerTokenAccountB,
          offer: offerPda,
          vault, // Anchor will handle creating this due to `init` in Rust
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY, // Good to include, Anchor might use it implicitly
        })
        .instruction();
      transaction.add(makeOfferIx);

      // Fetch fresh blockhash
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      // Sign and send transaction
      setStatus('Signing and sending transaction...');
      const signedTx = await signTransaction(transaction);
      const txSignature = await connection.sendRawTransaction(signedTx.serialize());
      console.log('Transaction Signature:', txSignature);

      // Confirm transaction
      await connection.confirmTransaction({ signature: txSignature, blockhash, lastValidBlockHeight }, 'confirmed');
      setStatus(`Offer created successfully with Offer ID ${offerIdBN.toString()}: ${txSignature}`);

      // Verify offer account
      const offerAccountInfo = await connection.getAccountInfo(offerPda);
      if (!offerAccountInfo) {
        throw new Error('Offer account was not created.');
      }
      console.log('Offer Account Data:', offerAccountInfo);

      // Reset form
      setTokenAAmount('');
      setTokenBAmount('');
      setTokenMintA('');
      setTokenMintB('');
    } catch (error) {
      setStatus(`Error: ${error.message || 'An unexpected error occurred.'}`);
      console.error('Error in handleMakeOffer:', error);
      if (error instanceof anchor.AnchorError) {
        console.error('Anchor Error Details:', {
          errorCode: error.errorCode,
          errorMessage: error.errorMessage,
          program: error.program.toBase58(),
          logs: error.logs,
        });
      }
      // Log transaction signature if available
      if (error.signature) {
        console.error('Failed Transaction Signature:', error.signature);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <style>
        {`
          .no-spinner::-webkit-inner-spin-button,
          .no-spinner::-webkit-outer-spin-button {
            -webkit-appearance: none;
            margin: 0;
          }
          .no-spinner {
            -moz-appearance: textfield;
          }
        `}
      </style>
      <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
        <div className="bg-gradient-to-r from-green-600 to-blue-600 px-6 py-4">
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Plus size={28} />
            Make Offer
          </h2>
          <p className="text-green-100 mt-1">Create a token swap offer</p>
        </div>

        <div className="p-6">
          <div className="space-y-6">
            {/* Token A Section */}
            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Token A (Offering)</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Token A Mint Address</label>
                  <input
                    type="text"
                    placeholder="Enter Token A mint address"
                    value={tokenMintA}
                    onChange={(e) => setTokenMintA(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all duration-200 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Amount to Offer</label>
                  <input
                    type="number"
                    placeholder="10"
                    value={tokenAAmount}
                    onChange={(e) => setTokenAAmount(e.target.value)}
                    min="0"
                    step="0.01"
                    className="no-spinner w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all duration-200"
                  />
                </div>
              </div>
            </div>

            {/* Arrow */}
            <div className="flex justify-center">
              <div className="bg-blue-100 p-3 rounded-full">
                <ArrowRight size={24} className="text-blue-600" />
              </div>
            </div>

            {/* Token B Section */}
            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Token B (Wanting)</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Token B Mint Address</label>
                  <input
                    type="text"
                    placeholder="Enter Token B mint address"
                    value={tokenMintB}
                    onChange={(e) => setTokenMintB(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Amount Wanted</label>
                  <input
                    type="number"
                    placeholder="10"
                    value={tokenBAmount}
                    onChange={(e) => setTokenBAmount(e.target.value)}
                    min="0"
                    step="0.01"
                    className="no-spinner w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                  />
                </div>
              </div>
            </div>

            {parseFloat(tokenAAmount) > 0 && parseFloat(tokenBAmount) > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="font-semibold text-blue-800 mb-2">Offer Summary</h4>
              <p className="text-blue-700 text-sm">
                You will offer <span className="font-semibold">{tokenAAmount || '0'} Token A</span> in exchange for <span className="font-semibold">{tokenBAmount || '0'} Token B</span>
              </p>
            </div>
            )}

            {/* Submit Button */}
            <button
              onClick={handleMakeOffer}
              disabled={!publicKey || !wallet || !signTransaction || isSubmitting}
              className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-gradient-to-r from-green-600 to-blue-600 hover:from-green-700 hover:to-blue-700 text-white font-semibold rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
            >
              {isSubmitting ? (
                <>
                  <Loader size={20} className="animate-spin" />
                  Creating Offer...
                </>
              ) : (
                <>
                  <Plus size={20} />
                  Make Offer
                </>
              )}
            </button>

            {/* Status */}
            {status && (
              <div className={`p-4 rounded-lg flex items-start gap-3 ${status.includes('Error')
                  ? 'bg-red-50 border border-red-200'
                  : status.includes('successfully')
                    ? 'bg-green-50 border border-green-200'
                    : 'bg-blue-50 border border-blue-200'
                }`}>
                {status.includes('Error') ? (
                  <AlertCircle size={20} className="text-red-500 mt-0.5 flex-shrink-0" />
                ) : status.includes('successfully') ? (
                  <CheckCircle size={20} className="text-green-500 mt-0.5 flex-shrink-0" />
                ) : (
                  <Loader size={20} className="text-blue-500 mt-0.5 flex-shrink-0 animate-spin" />
                )}
                <p className={`text-sm ${status.includes('Error')
                    ? 'text-red-700'
                    : status.includes('successfully')
                      ? 'text-green-700'
                      : 'text-blue-700'
                  }`}>
                  {status}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};