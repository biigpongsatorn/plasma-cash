import test from 'tape'
import Web3 from 'web3'
import { PlasmaUser } from 'loom-js'

import { increaseTime } from './ganache-helpers'
import { pollForBlockChange, sleep, ADDRESSES, ACCOUNTS, setupContracts } from './config'
import BN from 'bn.js'

// Alice registers and has 5 coins, and she deposits 3 of them.
const ALICE_INITIAL_COINS = 5
const ALICE_DEPOSITED_COINS = 3
const COINS = [1, 2, 3]

export async function runDemo(t: test.Test) {
  const web3Endpoint = 'ws://127.0.0.1:8545'
  const dappchainEndpoint = 'http://localhost:46658'
  const web3 = new Web3(new Web3.providers.WebsocketProvider(web3Endpoint))
  const { cards } = setupContracts(web3)

  const authority = PlasmaUser.createUser(
    web3Endpoint,
    ADDRESSES.root_chain,
    dappchainEndpoint,
    ACCOUNTS.authority
  )
  const alice = PlasmaUser.createUser(
    web3Endpoint,
    ADDRESSES.root_chain,
    dappchainEndpoint,
    ACCOUNTS.alice
  )
  const bob = PlasmaUser.createUser(
    web3Endpoint,
    ADDRESSES.root_chain,
    dappchainEndpoint,
    ACCOUNTS.bob
  )
  const charlie = PlasmaUser.createUser(
    web3Endpoint,
    ADDRESSES.root_chain,
    dappchainEndpoint,
    ACCOUNTS.charlie
  )

  await cards.registerAsync(alice.ethAddress)
  let balance = await cards.balanceOfAsync(alice.ethAddress)
  t.equal(balance.toNumber(), 5)
  let currentBlock = await authority.getCurrentBlockAsync()

  for (let i = 0; i < ALICE_DEPOSITED_COINS; i++) {
    await cards.depositToPlasmaAsync({ tokenId: COINS[i], from: alice.ethAddress })
    currentBlock = await pollForBlockChange(authority, currentBlock, 20, 2000)
  }

  // Get deposit events for all
  const deposits = await authority.allDeposits()
  t.equal(deposits.length, ALICE_DEPOSITED_COINS, 'All deposit events accounted for')

  // for (let i = 0; i < deposits.length; i++) {
  //   const deposit = deposits[i]
  //   t.equal(deposit.blockNumber.toNumber(), blk.toNumber() + i + 1, `Deposit ${i + 1} block number is correct`)
  //   t.equal(deposit.denomination.toNumber(), 1, `Deposit ${i + 1} denomination is correct`)
  //   t.equal(deposit.from, alice.ethAddress, `Deposit ${i + 1} sender is correct`)
  // }

  balance = await cards.balanceOfAsync(alice.ethAddress)
  t.equal(
    balance.toNumber(),
    ALICE_INITIAL_COINS - ALICE_DEPOSITED_COINS,
    'alice should have 2 tokens in cards contract'
  )
  balance = await cards.balanceOfAsync(ADDRESSES.root_chain)
  t.equal(
    balance.toNumber(),
    ALICE_DEPOSITED_COINS,
    'plasma contract should have 3 tokens in cards contract'
  )

  const coins = await alice.getUserCoinsAsync()
  t.ok(coins[0].slot.eq(deposits[0].slot), 'got correct deposit coins 1')
  t.ok(coins[1].slot.eq(deposits[1].slot), 'got correct deposit coins 2')
  t.ok(coins[2].slot.eq(deposits[2].slot), 'got correct deposit coins 3')

  // Alice to Bob, and Alice to Charlie. We care about the Alice to Bob
  // transaction
  const deposit2 = deposits[1]
  const deposit3 = deposits[2]

  // Alice -> Bob
  await alice.transferAndVerifyAsync(deposit3.slot, bob.ethAddress, 6)
  // Alice -> Charlie
  await alice.transferAndVerifyAsync(deposit2.slot, charlie.ethAddress, 6)
  currentBlock = await pollForBlockChange(authority, currentBlock, 20, 2000)
  await alice.refreshAsync()


  let aliceCoins = await alice.getUserCoinsAsync()
  t.ok(aliceCoins[0].slot.eq(deposits[0].slot), 'Alice has correct coin')
  t.equal(await charlie.receiveCoinAsync(deposit2.slot), true, 'charlie received coin')
  t.equal(await bob.receiveCoinAsync(deposit3.slot), true, 'bob received coin')

  // Multiple refreshes don't break it
  await bob.refreshAsync()
  await charlie.refreshAsync()

  // The legit operator will allow access to these variables as usual. The non-legit operator won't and as a result `getUserCoinsAsync` is empty
  if (bob.contractName !== 'hostileoperator') {
    let bobCoins = await bob.getUserCoinsAsync()
    t.ok(bobCoins[0].slot.eq(deposit3.slot), 'Bob has correct coin')
    let charlieCoins = await charlie.getUserCoinsAsync()
    t.ok(charlieCoins[0].slot.eq(deposit2.slot), 'Charlie has correct coin')
  }

  await bob.refreshAsync()
  await bob.refreshAsync()

  // // Bob -> Charlie
  await bob.transferAndVerifyAsync(deposit3.slot, charlie.ethAddress, 6)
  currentBlock = await pollForBlockChange(authority, currentBlock, 20, 2000)

  await charlie.refreshAsync()
  await charlie.refreshAsync()

  const coin = await charlie.getPlasmaCoinAsync(deposit3.slot)
  t.equal(await charlie.receiveCoinAsync(deposit3.slot), true, 'Coin history verified')
  charlie.watchExit(deposit3.slot, coin.depositBlockNum)

  await charlie.exitAsync(deposit3.slot)
  charlie.stopWatching(deposit3.slot)

  // Jump forward in time by 8 days
  await increaseTime(web3, 8 * 24 * 3600)
  // Charlie's exit should be finalizable...
  await authority.finalizeExitsAsync()
  // Charlie should now be able to withdraw the UTXO (plasma token) which contains ERC721 token #2
  // into his wallet.
  await charlie.withdrawAsync(deposit3.slot)

  balance = await cards.balanceOfAsync(alice.ethAddress)
  t.equal(balance.toNumber(), 2, 'alice should have 2 tokens in cards contract')
  balance = await cards.balanceOfAsync(bob.ethAddress)
  t.equal(balance.toNumber(), 0, 'bob should have no tokens in cards contract')
  balance = await cards.balanceOfAsync(charlie.ethAddress)
  t.equal(balance.toNumber(), 1, 'charlie should have 1 token in cards contract')

  // Close the websocket, hacky :/
  // @ts-ignore
  authority.disconnect()
  alice.disconnect()
  bob.disconnect()
  charlie.disconnect()
  // @ts-ignore
  web3.currentProvider.connection.close()

  t.end()
}
