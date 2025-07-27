import React, { useState, useEffect } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import * as anchor from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, getAccount } from '@solana/spl-token';
import idl from './idl/swap_idl.json';

export const TakeOffer = () => {
  const { publicKey, wallet, signTransaction } = useWallet();
  const { connection } = useConnection();
  const [offers, setOffers] = useState([]);
  const [selectedOffer, setSelectedOffer] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const validatePublicKey = (key, context) => {
    try {
      new PublicKey(key);
      return true;
    } catch (error) {
      console.error(`Invalid public key in ${context}:`, { key, error });
      return false;
    }
  };

  const fetchOffers = async () => {
    if (!publicKey || !wallet || !signTransaction) {
      setStatus('Please connect your wallet to fetch offers.');
      console.log('Wallet not connected');
      return;
    }

    setIsLoading(true);
    setStatus('Fetching offers...');
    try {
      const provider = new anchor.AnchorProvider(connection, { publicKey, signTransaction, signAllTransactions: wallet.signAllTransactions }, { commitment: 'confirmed' });
      const programId = new PublicKey(idl.address);
      const program = new anchor.Program(idl, provider);

      const offerAccounts = await program.account.offer.all();
      const parsedOffers = offerAccounts.map(({ publicKey, account }) => ({
        offerPda: publicKey.toBase58(),
        offerId: account.id.toString(),
        maker: account.maker.toBase58(),
        tokenMintA: account.tokenMintA.toBase58(),
        tokenMintB: account.tokenMintB.toBase58(),
        tokenAAmount: Number(account.tokenAAmount) / 10 ** 9,
        tokenBWantedAmount: Number(account.tokenBWantedAmount) / 10 ** 9,
      }));
      setOffers(parsedOffers);
      setStatus(parsedOffers.length > 0 ? 'Offers loaded successfully.' : 'No offers found.');
      console.log('Fetched offers:', parsedOffers);
    } catch (error) {
      setStatus(`Error fetching offers: ${error.message || 'An unexpected error occurred.'}`);
      console.error('Error in fetchOffers:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (publicKey && wallet && signTransaction) {
      fetchOffers();
    }
  }, [publicKey, wallet, signTransaction]);

  const handleTakeOffer = async (offer) => {
    console.log('handleTakeOffer started', { publicKey: publicKey?.toBase58(), offer });
    setIsModalOpen(false);
    setStatus('Taking offer...');

    if (!publicKey || !wallet || !signTransaction) {
      setStatus('Please connect your wallet.');
      console.log('Wallet not connected or signTransaction missing');
      return;
    }

    try {
      const provider = new anchor.AnchorProvider(connection, { publicKey, signTransaction, signAllTransactions: wallet.signAllTransactions }, { commitment: 'confirmed' });
      const programId = new PublicKey(idl.address);
      const program = new anchor.Program(idl, provider);

      // Validate inputs
      if (!validatePublicKey(offer.maker, 'Maker Public Key')) {
        setStatus('Invalid Maker Public Key.');
        console.log('Invalid Maker Public Key', { maker: offer.maker });
        return;
      }
      if (!validatePublicKey(offer.tokenMintA, 'Token A Mint')) {
        setStatus('Invalid Token A Mint address.');
        console.log('Invalid Token A Mint', { tokenMintA: offer.tokenMintA });
        return;
      }
      if (!validatePublicKey(offer.tokenMintB, 'Token B Mint')) {
        setStatus('Invalid Token B Mint address.');
        console.log('Invalid Token B Mint', { tokenMintB: offer.tokenMintB });
        return;
      }

      // Derive offer PDA
      const offerIdBN = new anchor.BN(offer.offerId);
      const [offerPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('offer'),
          new PublicKey(offer.maker).toBuffer(),
          offerIdBN.toArrayLike(Buffer, 'le', 8),
        ],
        programId
      );
      console.log('Derived offer PDA:', offerPda.toBase58());

      // Derive vault ATA
      const vault = await getAssociatedTokenAddress(
        new PublicKey(offer.tokenMintA),
        offerPda,
        true,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      console.log('Derived vault ATA:', vault.toBase58());

      // Derive taker token accounts
      const takerTokenAccountA = await getAssociatedTokenAddress(
        new PublicKey(offer.tokenMintA),
        publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      console.log('Derived taker Token A Account:', takerTokenAccountA.toBase58());

      const takerTokenAccountB = await getAssociatedTokenAddress(
        new PublicKey(offer.tokenMintB),
        publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      console.log('Derived taker Token B Account:', takerTokenAccountB.toBase58());

      const makerTokenAccountB = await getAssociatedTokenAddress(
        new PublicKey(offer.tokenMintB),
        new PublicKey(offer.maker),
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      console.log('Derived maker Token B Account:', makerTokenAccountB.toBase58());

      // Create Taker Token A Account if it doesn't exist
      const takerTokenAccountAInfo = await connection.getAccountInfo(takerTokenAccountA);
      let transaction = new Transaction();
      if (!takerTokenAccountAInfo) {
        setStatus('Creating Taker Token A Account...');
        console.log('Taker Token A Account does not exist, creating it...');
        transaction.add(
          createAssociatedTokenAccountInstruction(
            publicKey,
            takerTokenAccountA,
            publicKey,
            new PublicKey(offer.tokenMintA),
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        );
      }

      // Verify accounts exist
      const offerPdaInfo = await connection.getAccountInfo(offerPda);
      if (!offerPdaInfo) {
        setStatus('Offer PDA does not exist.');
        console.log('Offer PDA not found', { offerPda: offerPda.toBase58() });
        return;
      }
      const vaultInfo = await connection.getAccountInfo(vault);
      if (!vaultInfo) {
        setStatus('Vault ATA does not exist.');
        console.log('Vault ATA not found', { vault: vault.toBase58() });
        return;
      }
      const tokenMintAInfo = await connection.getAccountInfo(new PublicKey(offer.tokenMintA));
      if (!tokenMintAInfo) {
        setStatus('Token A Mint does not exist.');
        console.log('Token A Mint not found', { tokenMintA: offer.tokenMintA });
        return;
      }
      const tokenMintBInfo = await connection.getAccountInfo(new PublicKey(offer.tokenMintB));
      if (!tokenMintBInfo) {
        setStatus('Token B Mint does not exist.');
        console.log('Token B Mint not found', { tokenMintB: offer.tokenMintB });
        return;
      }
      const takerTokenAccountBInfo = await connection.getAccountInfo(takerTokenAccountB);
      if (!takerTokenAccountBInfo) {
        setStatus('Taker Token B Account does not exist.');
        console.log('Taker Token B Account not found', { takerTokenAccountB: takerTokenAccountB.toBase58() });
        return;
      }
      const makerTokenAccountBInfo = await connection.getAccountInfo(makerTokenAccountB);
      if (!makerTokenAccountBInfo) {
        setStatus('Maker Token B Account does not exist.');
        console.log('Maker Token B Account not found', { makerTokenAccountB: makerTokenAccountB.toBase58() });
        return;
      }

      // Verify account ownership
      if (!vaultInfo.owner.equals(TOKEN_PROGRAM_ID)) {
        setStatus('Vault ATA is not owned by the Token Program.');
        console.log('Vault ATA has incorrect owner', {
          vault: vault.toBase58(),
          owner: vaultInfo.owner.toBase58(),
          expected: TOKEN_PROGRAM_ID.toBase58(),
        });
        return;
      }
      if (takerTokenAccountAInfo && !takerTokenAccountAInfo.owner.equals(TOKEN_PROGRAM_ID)) {
        setStatus('Taker Token A Account is not owned by the Token Program.');
        console.log('Taker Token A Account has incorrect owner', {
          takerTokenAccountA: takerTokenAccountA.toBase58(),
          owner: takerTokenAccountAInfo.owner.toBase58(),
          expected: TOKEN_PROGRAM_ID.toBase58(),
        });
        return;
      }
      if (!takerTokenAccountBInfo.owner.equals(TOKEN_PROGRAM_ID)) {
        setStatus('Taker Token B Account is not owned by the Token Program.');
        console.log('Taker Token B Account has incorrect owner', {
          takerTokenAccountB: takerTokenAccountB.toBase58(),
          owner: takerTokenAccountBInfo.owner.toBase58(),
          expected: TOKEN_PROGRAM_ID.toBase58(),
        });
        return;
      }
      if (!makerTokenAccountBInfo.owner.equals(TOKEN_PROGRAM_ID)) {
        setStatus('Maker Token B Account is not owned by the Token Program.');
        console.log('Maker Token B Account has incorrect owner', {
          makerTokenAccountB: makerTokenAccountB.toBase58(),
          owner: makerTokenAccountBInfo.owner.toBase58(),
          expected: TOKEN_PROGRAM_ID.toBase58(),
        });
        return;
      }

      // Verify token account mints
      const vaultData = await getAccount(connection, vault);
      if (!vaultData.mint.equals(new PublicKey(offer.tokenMintA))) {
        setStatus('Vault ATA is not associated with Token A Mint.');
        console.log('Vault ATA mint mismatch', {
          vaultMint: vaultData.mint.toBase58(),
          expectedMint: offer.tokenMintA,
        });
        return;
      }
      if (takerTokenAccountAInfo) {
        const takerTokenAccountAData = await getAccount(connection, takerTokenAccountA);
        if (!takerTokenAccountAData.mint.equals(new PublicKey(offer.tokenMintA))) {
          setStatus('Taker Token A Account is not associated with Token A Mint.');
          console.log('Taker Token A Account mint mismatch', {
            tokenAccountMint: takerTokenAccountAData.mint.toBase58(),
            expectedMint: offer.tokenMintA,
          });
          return;
        }
      }
      const takerTokenAccountBData = await getAccount(connection, takerTokenAccountB);
      if (!takerTokenAccountBData.mint.equals(new PublicKey(offer.tokenMintB))) {
        setStatus('Taker Token B Account is not associated with Token B Mint.');
        console.log('Taker Token B Account mint mismatch', {
          tokenAccountMint: takerTokenAccountBData.mint.toBase58(),
          expectedMint: offer.tokenMintB,
        });
        return;
      }
      const makerTokenAccountBData = await getAccount(connection, makerTokenAccountB);
      if (!makerTokenAccountBData.mint.equals(new PublicKey(offer.tokenMintB))) {
        setStatus('Maker Token B Account is not associated with Token B Mint.');
        console.log('Maker Token B Account mint mismatch', {
          tokenAccountMint: makerTokenAccountBData.mint.toBase58(),
          expectedMint: offer.tokenMintB,
        });
        return;
      }

      // Verify taker has sufficient Token B balance
      const tokenBAmountLamports = Number(offer.tokenBWantedAmount) * 10 ** 9;
      if (takerTokenAccountBData.amount < BigInt(tokenBAmountLamports)) {
        setStatus(`Insufficient balance in Taker Token B Account. Need ${offer.tokenBWantedAmount} tokens.`);
        console.log('Insufficient balance in Token B', {
          available: Number(takerTokenAccountBData.amount) / 10 ** 9,
          required: offer.tokenBWantedAmount,
        });
        return;
      }

      // Add takeOffer instruction
      const takeOfferIx = await program.methods
        .takeOffer()
        .accounts({
          taker: publicKey,
          maker: new PublicKey(offer.maker),
          tokenMintA: new PublicKey(offer.tokenMintA),
          tokenMintB: new PublicKey(offer.tokenMintB),
          takerTokenAccountA,
          takerTokenAccountB,
          makerTokenAccountB,
          offer: offerPda,
          vault,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .instruction();

      transaction.add(takeOfferIx);

      // Check transaction size
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;
      const txSize = transaction.serializeMessage().length;
      console.log('Estimated transaction size:', txSize, 'bytes');

      if (txSize > 1232) {
        setStatus('Transaction too large. Splitting into two transactions...');
        console.log('Transaction size exceeds 1232 bytes, splitting');

        // Send ATA creation transaction if needed
        if (!takerTokenAccountAInfo) {
          const ataTransaction = new Transaction().add(
            createAssociatedTokenAccountInstruction(
              publicKey,
              takerTokenAccountA,
              publicKey,
              new PublicKey(offer.tokenMintA),
              TOKEN_PROGRAM_ID,
              ASSOCIATED_TOKEN_PROGRAM_ID
            )
          );
          ataTransaction.recentBlockhash = blockhash;
          ataTransaction.feePayer = publicKey;
          const signedAtaTx = await signTransaction(ataTransaction);
          const ataTxSignature = await connection.sendRawTransaction(signedAtaTx.serialize());
          console.log('Token A ATA creation transaction sent:', { signature: ataTxSignature });
          await connection.confirmTransaction({ signature: ataTxSignature, blockhash, lastValidBlockHeight }, 'confirmed');
          console.log('Token A ATA creation transaction confirmed');
          setStatus('Taker Token A Account created. Proceeding with take offer...');
        }

        // Send takeOffer transaction
        const takeOfferTransaction = new Transaction().add(takeOfferIx);
        takeOfferTransaction.recentBlockhash = blockhash;
        takeOfferTransaction.feePayer = publicKey;
        const signedTakeOfferTx = await signTransaction(takeOfferTransaction);
        const takeOfferTxSignature = await connection.sendRawTransaction(signedTakeOfferTx.serialize());
        console.log('Offer transaction sent', { signature: takeOfferTxSignature });
        await connection.confirmTransaction({ signature: takeOfferTxSignature, blockhash, lastValidBlockHeight }, 'confirmed');
        console.log('Offer transaction confirmed');
        setStatus(`Offer taken successfully: ${takeOfferTxSignature}`);
      } else {
        // Send combined transaction
        const signedTx = await signTransaction(transaction);
        const txSignature = await connection.sendRawTransaction(signedTx.serialize());
        console.log('Offer transaction sent', { signature: txSignature });
        await connection.confirmTransaction({ signature: txSignature, blockhash, lastValidBlockHeight }, 'confirmed');
        console.log('Offer transaction confirmed');
        setStatus(`Offer taken successfully: ${txSignature}`);
      }
    } catch (error) {
      setStatus(`Error: ${error.message || 'An unexpected error occurred.'}`);
      console.error('Error in handleTakeOffer:', error);
      if (error instanceof anchor.AnchorError) {
        console.error('Anchor Error Details:', {
          errorCode: error.errorCode,
          errorMessage: error.errorMessage,
          program: error.program.toBase58(),
          logs: error.logs,
        });
      }
    }
  };

  const openModal = (offer) => {
    setSelectedOffer(offer);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setSelectedOffer(null);
    setIsModalOpen(false);
  };

  return (
    <div className="take-offer container mx-auto p-4">
      <h2 className="text-2xl font-bold mb-4">Take Offer</h2>
      {isLoading ? (
        <p className="text-gray-600">Loading offers...</p>
      ) : offers.length === 0 ? (
        <p className="text-gray-600">No offers available.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full bg-white border border-gray-200">
            <thead>
              <tr className="bg-gray-100">
                <th className="py-2 px-4 border-b">Offer ID</th>
                <th className="py-2 px-4 border-b">Maker</th>
                <th className="py-2 px-4 border-b">Token A Mint</th>
                <th className="py-2 px-4 border-b">Token A Amount</th>
                <th className="py-2 px-4 border-b">Token B Mint</th>
                <th className="py-2 px-4 border-b">Token B Wanted</th>
                <th className="py-2 px-4 border-b">Action</th>
              </tr>
            </thead>
            <tbody>
              {offers.map((offer) => (
                <tr key={offer.offerPda} className="hover:bg-gray-50">
                  <td className="py-2 px-4 border-b">{offer.offerId}</td>
                  <td className="py-2 px-4 border-b truncate max-w-xs">{offer.maker}</td>
                  <td className="py-2 px-4 border-b truncate max-w-xs">{offer.tokenMintA}</td>
                  <td className="py-2 px-4 border-b">{offer.tokenAAmount}</td>
                  <td className="py-2 px-4 border-b truncate max-w-xs">{offer.tokenMintB}</td>
                  <td className="py-2 px-4 border-b">{offer.tokenBWantedAmount}</td>
                  <td className="py-2 px-4 border-b">
                    <button
                      onClick={() => openModal(offer)}
                      className="bg-blue-500 hover:bg-blue-600 text-white py-1 px-2 rounded disabled:bg-gray-400"
                      disabled={!publicKey || !wallet || !signTransaction}
                    >
                      Take Offer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-4 text-gray-600">{status}</p>

      {isModalOpen && selectedOffer && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
          <div className="bg-white p-6 rounded-lg shadow-lg max-w-md w-full">
            <h3 className="text-xl font-bold mb-4">Confirm Take Offer</h3>
            <p><strong>Offer ID:</strong> {selectedOffer.offerId}</p>
            <p><strong>Maker:</strong> {selectedOffer.maker}</p>
            <p><strong>Token A Mint:</strong> {selectedOffer.tokenMintA}</p>
            <p><strong>Token A Amount:</strong> {selectedOffer.tokenAAmount}</p>
            <p><strong>Token B Mint:</strong> {selectedOffer.tokenMintB}</p>
            <p><strong>Token B Wanted:</strong> {selectedOffer.tokenBWantedAmount}</p>
            <p className="mt-4 text-sm text-gray-600">
              You will receive {selectedOffer.tokenAAmount} Token A and send {selectedOffer.tokenBWantedAmount} Token B.
            </p>
            <div className="mt-6 flex justify-end space-x-4">
              <button
                onClick={closeModal}
                className="bg-gray-300 hover:bg-gray-400 text-black py-2 px-4 rounded"
              >
                Cancel
              </button>
              <button
                onClick={() => handleTakeOffer(selectedOffer)}
                className="bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};