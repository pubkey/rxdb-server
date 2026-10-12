/**
 * A reusable performance test suite for RxDB server adapters.
 * This function can be exported and used by consumers who
 * create custom adapters to verify their performance characteristics.
 */
import type { RxDatabase } from 'rxdb/plugins/core';
import type { RxServerAdapter } from './types.ts';
export type PerformanceTestResult = {
    /** Name of the test case */
    name: string;
    /** Total time in milliseconds */
    timeMs: number;
    /** Number of operations performed */
    opsCount: number;
    /** Calculated operations per second */
    opsPerSecond: number;
};
export type PerformanceTestOptions<ServerAppType> = {
    adapter: RxServerAdapter<ServerAppType, any, any>;
    /**
     * Function that creates a fresh RxDatabase instance.
     * Must return a database that can be closed after each test.
     */
    createDatabase: () => Promise<RxDatabase>;
    /**
     * Function that resolves an available port for the server.
     */
    getPort: () => Promise<number>;
    /**
     * Number of documents to use for each test.
     * [default=30]
     */
    batchSize?: number;
};
/**
 * Runs a set of performance tests against the given adapter.
 * Each test creates its own server and collection, measures
 * the time for the operations, and tears down afterwards.
 *
 * Returns an array of results that callers can assert against
 * or log for comparison purposes.
 */
export declare function performanceTest<ServerAppType>(options: PerformanceTestOptions<ServerAppType>): Promise<PerformanceTestResult[]>;
