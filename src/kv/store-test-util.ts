import {assert, expect} from '@esm-bundle/chai';
import {Store, WrapStore} from './store';

export async function runAll(
  newStore: () => Promise<Store> | Store,
): Promise<void> {
  let s = new WrapStore(await newStore());
  await store(s);
  s = new WrapStore(await newStore());
  await readTransaction(s);
  s = new WrapStore(await newStore());
  await writeTransaction(s);
  s = new WrapStore(await newStore());
  await isolation(s);
}

function b(x: TemplateStringsArray): Uint8Array {
  return new TextEncoder().encode(x[0]);
}

async function store(store: WrapStore): Promise<void> {
  // Test put/has/get, which use read() and write() for one-shot txs.
  assert.isFalse(await store.has('foo'));
  assert.equal(undefined, await store.get('foo'));

  await store.put('foo', b`bar`);
  assert.isTrue(await store.has('foo'));
  expect(await store.get('foo')).to.deep.equal(b`bar`);

  await store.put('foo', b`baz`);
  assert.isTrue(await store.has('foo'));
  expect(await store.get('foo')).to.deep.equal(b`baz`);

  assert.isTrue(!(await store.has('baz')));
  assert.equal(undefined, await store.get('baz'));
  await store.put('baz', b`bat`);
  assert.isTrue(await store.has('baz'));
  expect(await store.get('baz')).to.deep.equal(b`bat`);
}

async function readTransaction(store: WrapStore): Promise<void> {
  await store.put('k1', b`v1`);

  await store.withRead(async rt => {
    expect(await rt.has('k1')).to.be.true;
    expect(b`v1`).to.deep.equal(await rt.get('k1'));
  });
}

async function writeTransaction(store: WrapStore): Promise<void> {
  await store.put('k1', b`v1`);
  await store.put('k2', b`v2`);

  // Test put then commit.
  await store.withWrite(async wt => {
    assert.isTrue(await wt.has('k1'));
    assert.isTrue(await wt.has('k2'));
    await wt.put('k1', b`overwrite`);
    await wt.commit();
  });
  assert.deepEqual(b`overwrite`, await store.get('k1'));
  assert.deepEqual(b`v2`, await store.get('k2'));

  // Test put then rollback.
  await store.withWrite(async wt => {
    await wt.put('k1', b`should be rolled back`);
    await wt.rollback();
  });
  assert.deepEqual(b`overwrite`, await store.get('k1'));

  // Test del then commit.
  await store.withWrite(async wt => {
    await wt.del('k1');
    assert.isFalse(await wt.has('k1'));
    await wt.commit();
  });
  assert.isFalse(await store.has('k1'));

  // Test del then rollback.
  assert.equal(true, await store.has('k2'));
  await store.withWrite(async wt => {
    await wt.del('k2');
    assert.isFalse(await wt.has('k2'));
    await wt.rollback();
  });
  assert.isTrue(await store.has('k2'));

  // Test overwrite multiple times then commit.
  await store.withWrite(async wt => {
    await wt.put('k2', b`overwrite`);
    await wt.del('k2');
    await wt.put('k2', b`final`);
    await wt.commit();
  });
  assert.deepEqual(b`final`, await store.get('k2'));

  // Test Read interface on Write.
  await store.withWrite(async wt => {
    await wt.put('k2', b`new value`);
    assert.isTrue(await wt.has('k2'));
    assert.deepEqual(b`new value`, await wt.get('k2'));
  });
}

async function isolation(store: WrapStore): Promise<void> {
  // Assert there can be multiple concurrent read txs...
  const r1 = await store.read();
  const r2 = await store.read();

  // and that while outstanding they prevent write txs...
  const dur = 200;
  const w = store.write();
  w.then(w => w.release());

  if (await timeout(dur, w)) {
    console.error('2 open read tx should have prevented new write');
    assert.fail();
  }
  // until both the reads are done...
  r1.release();

  {
    const w = store.write();
    w.then(w => w.release());
    if (await timeout(dur, w)) {
      console.error('1 open read tx should have prevented new write');
      assert.fail();
    }
    r2.release();

    {
      const w = await store.write();

      // At this point we have a write tx outstanding. Assert that
      // we cannot open another write transaction.
      {
        const w2 = store.write();
        w2.then(w2 => w2.release());
        if (await timeout(dur, w2)) {
          console.error('1 open write tx should have prevented new write');
          assert.fail();
        }

        // The write tx is still outstanding, ensure we cannot open
        // a read tx until it is finished.
        const r = store.read();
        r.then(r => r.release());
        if (await timeout(dur, r)) {
          console.error('1 open write tx should have prevented new read');
          assert.fail();
        }
        await w.rollback();
        w.release();

        {
          const r = await store.read();
          assert.isFalse(await r.has('foo'));
        }
      }
    }
  }
}

async function timeout(dur: number, w: Promise<unknown>): Promise<boolean> {
  const sentinel = {};
  const result = await Promise.race([sleep(dur, sentinel), w]);
  if (result === sentinel) {
    return false;
  }
  return true;
}

function sleep<T>(ms: number, v: T): Promise<T> {
  return new Promise(resolve =>
    setTimeout(() => {
      resolve(v);
    }, ms),
  );
}
