/**
 * Micro-benchmark for the `mergeServerDocumentFieldsMonad` helper.
 *
 * Measures the merge operation in both the new-document branch
 * (no serverDoc) and the update branch (existing serverDoc), because the
 * bug fix changes the new-document branch.
 *
 * Run with: `npx ts-node --transpile-only ./test/performance-merge-server-fields.ts`
 */
import { mergeServerDocumentFieldsMonad } from '../plugins/server/index.mjs';

const ITERATIONS = 200000;
const serverOnlyFields = ['lastName', 'secret', 'internal'];

type Doc = {
    passportId: string;
    firstName: string;
    lastName?: string;
    secret?: string;
    internal?: string;
    age: number;
};

const baseClientDoc: Doc = {
    passportId: 'pid-1',
    firstName: 'Alice',
    lastName: 'ClientSupplied',
    secret: 'ClientSecret',
    internal: 'ClientInternal',
    age: 30
};
const baseServerDoc: any = {
    passportId: 'pid-1',
    firstName: 'Alice',
    lastName: 'ServerStored',
    secret: 'ServerSecret',
    internal: 'ServerInternal',
    age: 30,
    _meta: { lwt: Date.now() },
    _rev: '1-a',
    _attachments: {}
};

function bench(label: string, fn: () => void) {
    // warm-up
    for (let i = 0; i < 5000; i++) {
        fn();
    }
    const start = process.hrtime.bigint();
    for (let i = 0; i < ITERATIONS; i++) {
        fn();
    }
    const end = process.hrtime.bigint();
    const totalMs = Number(end - start) / 1e6;
    const opsPerSec = Math.round(ITERATIONS / (totalMs / 1000));
    console.log(
        label.padEnd(40) +
        ' total=' + totalMs.toFixed(2).padStart(8) + 'ms' +
        ' ops/s=' + opsPerSec.toString().padStart(10)
    );
}

async function run() {
    const merge = mergeServerDocumentFieldsMonad<Doc>(serverOnlyFields);

    console.log(
        '\nBenchmark: mergeServerDocumentFieldsMonad' +
        ' (iterations=' + ITERATIONS + ', fields=' + serverOnlyFields.length + ')\n'
    );

    bench('new doc (no serverDoc)', () => {
        merge({ ...baseClientDoc });
    });
    bench('update doc (with serverDoc)', () => {
        merge({ ...baseClientDoc }, baseServerDoc);
    });
    bench('update doc (serverDoc missing fields)', () => {
        merge(
            { ...baseClientDoc },
            { passportId: 'pid-1', firstName: 'Alice', age: 30 } as any
        );
    });
    console.log('');
}

run();
