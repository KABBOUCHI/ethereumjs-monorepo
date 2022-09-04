import { keccak256 } from '@ethereumjs/devp2p'
import { RLP } from '@ethereumjs/rlp'
import { CheckpointTrie, Trie } from '@ethereumjs/trie'
import { KECCAK256_NULL, KECCAK256_RLP, arrToBufArr, isFalsy } from '@ethereumjs/util'

import { LevelDB } from '../../execution/level'

import { Fetcher } from './fetcher'

import type { Peer } from '../../net/peer'
import type { FetcherOptions } from './fetcher'
// import { Chain } from '../../blockchain'
import type { Job } from './types'
import type { Account } from '@ethereumjs/util'

/**
 * Converts a slim account (per snap protocol spec) to the RLP encoded version of the account
 * @param body Array of 4 Buffer-like items to represent the account
 * @returns RLP encoded version of the account
 */
function convertSlimAccount(body: any) {
	const cpy = [body[0], body[1], body[2], body[3]]
	if (arrToBufArr(body[2]).length === 0) {
		// StorageRoot
		cpy[2] = KECCAK256_RLP
	}
	if (arrToBufArr(body[3]).length === 0) {
		// CodeHash
		cpy[3] = KECCAK256_NULL
	}
	return arrToBufArr(RLP.encode(cpy))
}


type AccountData = {
	hash: Buffer
	body: any
}

/**
 * Implements an snap1 based account fetcher
 * @memberof module:sync/fetcher
 */
export interface AccountFetcherOptions extends FetcherOptions {
	/** Root hash of the account trie to serve */
	root: Buffer

	/** Account hash of the first to retrieve */
	origin: Buffer

	/** Account hash after which to stop serving data */
	limit: Buffer

	/** Per task limit of bytes to request from peer */
	bytes: bigint

	/** Destroy fetcher once all tasks are done */
	destroyWhenDone?: boolean
}

// root comes from block?
export type JobTask = {
	origin: Buffer
	limit: Buffer
}

export class AccountFetcher extends Fetcher<JobTask, AccountData[], AccountData> {
  /**
   * Where the fetcher starts apart from the tasks already in the `in` queue.
   */
  root: Buffer
  /**
   * Account hash of the first to retrieve
   */
  origin: Buffer
  /**
   * Account hash after which to stop serving data
   */
  limit: Buffer
  /**
   * Soft limit at which to stop returning data
   */
  bytes: bigint

	/**
	 * MPT for storing account data with proofs - keys are hashed and data is in slim format (SNAPSHOT)
	 */
	accountTrie: CheckpointTrie

	/**
	 * Create new block fetcher
	 */
	constructor(options: AccountFetcherOptions) {
		super(options)

		// this.accountTrie = new CheckpointTrie({ db: new LevelDB(), root: options.root })
		this.accountTrie = new CheckpointTrie({ db: new LevelDB() })

		this.root = options.root
		this.origin = options.origin
		this.limit = options.limit
		this.bytes = options.bytes

		this.debug(
			`Account fetcher instantiated root=${this.root} origin=${this.origin} limit=${this.limit} bytes=${this.bytes} destroyWhenDone=${this.destroyWhenDone}`
		)
	}

  /**
   * Request results from peer for the given job.
   * Resolves with the raw result
   * If `undefined` is returned, re-queue the job.
   * @param job
   * @param peer
   */
  async request(job: Job<JobTask, AccountData[], AccountData>): Promise<AccountData[] | undefined> {
    const { task, peer, partialResult } = job
    const { origin, limit } = task

    const rangeResult = await peer!.snap!.getAccountRange({
      root: this.root,
      origin,
      limit,
      bytes: this.bytes,
    })

		const peerInfo = `id=${peer?.id.slice(0, 8)} address=${peer?.address}`

		if (!rangeResult
			|| !rangeResult.accounts
			|| !rangeResult.proof
		) {
			// catch occasional null, empty, or incomplete responses
			this.debug(`Peer ${peerInfo} returned incomplete account range response for origin=${origin} and limit=${limit}`)
			return undefined
		}

		const trie = new Trie()
		const { accounts, proof } = rangeResult
		const hashes: Buffer[] = []
		const values: Buffer[] = []

		// put all accounts into the Trie
		for (let i = 0; i < accounts.length; i++) {
			// ensure the range is monotonically increasing
			if (i != accounts.length - 1) {
				if (accounts[i].hash.compare(accounts[i + 1].hash) === 1) {
					this.debug(`Peer ${peerInfo} returned Account hashes not monotonically increasing: ${i} ${accounts[i].hash} vs ${i + 1} ${accounts[i + 1].hash}`)
				}
			}
			// put account data into trie
			const { hash, body } = accounts[i]
			hashes.push(hash)
			const value = convertSlimAccount(body)
			values.push(value)
			await trie.put(hash, value)
		}

    // validate the proof
    try {
      // verify account data for account range received from peer using proof and state root
      const checkRangeProof = await trie.verifyRangeProof(
        this.root,
        this.origin,
        hashes[hashes.length - 1],
        hashes,
        values,
        proof
      )
      this.debug('Proof for account range found to be valid: ' + checkRangeProof)
      if (!checkRangeProof) {
        this.debug(`Proof-based verification failed`)
        return undefined
      }
    } catch (err) {
      this.debug(`Proof-based verification failed: ${err}`)
      return undefined
    }

		// TODO I am not sure if this check is necessary since proof verification should be establishing the correctness of every newly put account data
		// verify that it is possible to get the accounts, and that the values are correct
		for (let i = 0; i <= accounts.length - 1; i++) {
			const account = accounts[i]
			const key = account.hash
			const expect = convertSlimAccount(account.body)
			const value = await trie.get(key)
			if (value === undefined || !value?.equals(expect)) {
				this.debug('Key/value pair does not match expected value')
				return undefined
			}
		}

    return accounts
  }

  /**
   * Process the reply for the given job.
   * If the reply contains unexpected data, return `undefined`,
   * this re-queues the job.
   * @param job fetch job
   * @param result result data
   */
  process(
    job: Job<JobTask, AccountData[], AccountData>,
    result: AccountData[]
  ): AccountData[] | undefined {
    console.log('inside accountfetcher.process')
    return result
  }

  /**
   * Store fetch result. Resolves once store operation is complete.
   * @param result fetch result
   */
  async store(result: AccountData[]): Promise<void> {
    this.debug('inside accountfetcher.store')
    try {
      for (let i = 0; i < result.length; i++) {
        const { hash, body } = result[i]

        // TODO can be optimized by converting from slim to full in request phase inside first loop
        this.accountTrie.put(hash, convertSlimAccount(body))
      }
      // TODO add event emission if necessary

      this.debug(`Stored ${result.length} accounts in account trie`)
    } catch (err) {
      this.debug(`Failed to store account data: ${err}`)
    }

    // for data capture
    // process.exit()
  }

  /**
   * Generate list of tasks to fetch. Modifies `first` and `count` to indicate
   * remaining items apart from the tasks it pushes in the queue
   */
  tasks(
    origin = this.origin,
    limit = this.limit,
    maxTasks = this.config.maxFetcherJobs
  ): JobTask[] {
    const max = this.config.maxPerRequest
    const tasks: JobTask[] = []
    tasks.push({ origin, limit })

		console.log(`Created new tasks num=${tasks.length} tasks=${tasks}`)
		return tasks
	}

	nextTasks(): void {
		const tasks = this.tasks(this.origin, this.limit)
		for (const task of tasks) {
			this.enqueueTask(task)
		}
	}

	/**
	 * Clears all outstanding tasks from the fetcher
	 */
	clear() {
		return
	}

	/**
 * Returns an idle peer that can process a next job.
 */
	peer(): Peer | undefined {
		return this.pool.idle((peer) => 'snap' in peer)
	}
}