import { Account } from '@ethereumjs/util'
import { Peer } from '../../net/peer'
import { Fetcher, FetcherOptions } from './fetcher'
// import { Chain } from '../../blockchain'
import { Job } from './types'

export interface AccountFetcherOptions extends FetcherOptions {
	/** Root hash of the account trie to serve */
	root: Buffer

	/** Account hash of the first to retrieve */
	origin: Buffer

	/** Account hash after which to stop serving data */
	limit: Buffer

	/** Soft limit at which to stop returning data */
	bytes: bigint

	/** Destroy fetcher once all tasks are done */
	destroyWhenDone?: boolean
}

// root comes from block?
export type JobTask = {
	root: Buffer
	origin: Buffer
	limit: Buffer
	bytes: bigint
}

export class AccountFetcher extends Fetcher<
	JobTask,
	Account[],
	Account
> {
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
	 * Create new block fetcher
	 */
	constructor(options: AccountFetcherOptions) {
		super(options)

		this.root = options.root
		this.origin = options.origin
		this.limit = options.limit
		this.bytes = options.bytes
		this.debug(
			`Block fetcher instantiated root=${this.root} origin=${this.origin} limit=${this.limit} bytes=${this.bytes} destroyWhenDone=${this.destroyWhenDone}`
		)
	}

	/**
	 * Request results from peer for the given job.
	 * Resolves with the raw result
	 * If `undefined` is returned, re-queue the job.
	 * @param job
	 * @param peer
	 */
	async request(job: Job<JobTask, Account[], Account>): Promise<Account[] | undefined> {
        // const { task, peer, partialResult } = job
        // let { root, origin, limit, bytes } = task

        // const rangeResult = await peer!.snap!.getAccountRange({
        //   root: root,
        //   origin: origin,
        //   limit: limit,
        //   bytes: bytes,
        // })

        // for (let i = 0; i < rangeResult.accounts.length; i++) {
        //   console.log({ 
        //     account: rangeResult?.accounts[i],
        //     proof: rangeResult?.proof[i]
        //    })
        // }

        // if (rangeResult) {
        //   process.exit()
        // }
        
        // return
	}

	/**
	 * Process the reply for the given job.
	 * If the reply contains unexpected data, return `undefined`,
	 * this re-queues the job.
	 * @param job fetch job
	 * @param result result data
	 */
	process(job: Job<JobTask, Account[], Account>, result: Account[]): Account[] | undefined {
		return
	}

	/**
	* Store fetch result. Resolves once store operation is complete.
	* @param result fetch result
	*/
	async store(result: Account[]): Promise<void> {
		return
	}
}