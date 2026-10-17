function harness({ delay = 1000, reply, hang = false } = {}) {
  let time = 0;
  let serial = 0;
  let active = 0;
  let peak = 0;
  const queue = [];
  const calls = [];
  const logs = [];
  function schedule(fn, ms) { queue.push({ fn, at: time + ms, id: serial++ }); }
  const runtime = {
    now: () => time, random: () => 0.123,
    setTimeout: schedule, log: text => logs.push(text),
    request(spec) {
      calls.push({ ...spec, start: time });
      active++;
      peak = Math.max(peak, active);
      if (hang) return new Promise(() => {});
      return new Promise((resolve, reject) => schedule(() => {
        active--;
        try {
          const range = spec.headers && spec.headers.Range;
          const value = reply ? reply(spec) : spec.method === 'HEAD' ? {
            status: 200, binary: true, bytes: 0,
            headers: { 'Accept-Ranges': 'bytes', 'Content-Length': '4294967296' }
          } : {
            status: range ? 206 : 200, binary: true, bytes: spec.method === 'HEAD' ? 0 : spec.bytes,
            headers: range ? { 'Content-Range': 'bytes 0-' + (spec.bytes - 1) + '/4294967296', 'Content-Length': String(spec.bytes) } : {}
          };
          if (value instanceof Error) reject(value); else resolve(value);
        } catch (error) { reject(error); }
      }, typeof delay === 'function' ? delay(spec) : delay));
    }
  };
  async function flush() { for (let i = 0; i < 25; i++) await Promise.resolve(); }
  async function settle(promise) {
    let done = false;
    let value;
    let error;
    promise.then(result => { value = result; done = true; }, err => { error = err; done = true; });
    for (let i = 0; i < 20000 && !done; i++) {
      await flush();
      if (done) break;
      queue.sort((a, b) => a.at - b.at || a.id - b.id);
      if (!queue.length) throw new Error('Promise 未完成且没有待运行事件');
      const next = queue.shift();
      time = next.at;
      next.fn();
    }
    if (!done) throw new Error('调度循环超限');
    if (error) throw error;
    return value;
  }
  async function drain() {
    while (queue.length) {
      queue.sort((a, b) => a.at - b.at || a.id - b.id);
      const next = queue.shift();
      time = next.at;
      next.fn();
      await flush();
    }
  }
  return { runtime, calls, logs, settle, drain, get peak() { return peak; }, get now() { return time; } };
}
module.exports = harness;
