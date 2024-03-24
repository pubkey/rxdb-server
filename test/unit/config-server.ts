/**
 * We define the adapter for the tests in this file
 * so in other repos we can swap out the file
 * and run the test suite with other custom adapters.
 */
import {
    RxServerAdapterExpress
} from '../../plugins/adapter-express';

export const TEST_SERVER_ADAPTER = RxServerAdapterExpress;
