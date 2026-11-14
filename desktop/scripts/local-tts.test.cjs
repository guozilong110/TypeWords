const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createLocalTts, createSpeechFallback } = require('../local-tts.cjs')

test('online success does not invoke offline speech', async () => {
  const speak = createSpeechFallback(async () => 'online', {
    synthesize() { assert.fail('offline should not run') },
  })
  assert.equal(await speak('hello'), 'online')
})

test('online failure falls back and skips online during cooldown', async () => {
  let onlineCalls = 0
  const requests = []
  const speak = createSpeechFallback(async () => { onlineCalls++; throw new Error('offline') }, {
    async synthesize(text, cfg) { requests.push([text, cfg]); return 'local' },
  })
  const cfg = { lengthScale: 0.75 }
  assert.equal(await speak('hello', cfg), 'local')
  assert.equal(await speak('world', cfg), 'local')
  assert.equal(onlineCalls, 1)
  assert.deepEqual(requests, [['hello', cfg], ['world', cfg]])
})

test('both services failing returns null; empty input does not request speech', async () => {
  let calls = 0
  const speak = createSpeechFallback(async () => { calls++; return null }, {
    async synthesize() { return null },
  })
  assert.equal(await speak('   '), null)
  assert.equal(calls, 0)
  assert.equal(await speak('hello'), null)
})

test('worker persists across requests; stop terminates it and settles pending speech', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'typewords-tts-test-'))
  const script = path.join(temp, 'worker.py')
  fs.writeFileSync(script, `import sys, json, os, time
print(json.dumps({'ready': True}), flush=True)
for line in sys.stdin:
    r = json.loads(line)
    if r['text'] == 'wait':
        time.sleep(60)
    print(json.dumps({'id': r['id'], 'src': str(os.getpid())}), flush=True)
`)
  const worker = createLocalTts({ script })
  try {
    assert.equal(await worker.start(), true)
    const first = await worker.synthesize('hello')
    const second = await worker.synthesize('world')
    assert.match(first, /^\d+$/)
    assert.equal(second, first)
    const pending = worker.synthesize('wait')
    await new Promise(resolve => setImmediate(resolve))
    worker.stop()
    assert.equal(await pending, null)
    assert.equal(await worker.start(), false)
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 3000
      const check = () => {
        try { process.kill(Number(first), 0) } catch { resolve(); return }
        if (Date.now() > deadline) { reject(new Error('Worker survived stop')); return }
        setTimeout(check, 25)
      }
      check()
    })
  } finally {
    worker.stop()
    fs.rmSync(temp, { recursive: true, force: true })
  }
})
