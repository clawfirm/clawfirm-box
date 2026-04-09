import test from 'node:test';
import assert from 'node:assert/strict';

import { getConfig } from '../src/config.js';

test('getConfig accepts short single-box env var aliases', () => {
  const config = getConfig({
    PORT: '8788',
    CLAWFIRM_ADAPTER_TOKEN: 'mini_secret',
    CLAWFIRM_SITES_ROOT: '/srv/mini-sites',
    CLAWFIRM_CADDY_SNIPPETS_DIR: '/etc/caddy/mini-sites',
  });

  assert.equal(config.port, 8788);
  assert.equal(config.sharedSecret, 'mini_secret');
  assert.equal(config.sitesRoot, '/srv/mini-sites');
  assert.equal(config.caddySitesDir, '/etc/caddy/mini-sites');
});

