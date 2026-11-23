import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exportStates } from '../src/modules/exportStates.ts'

test('export states: empty / ready / sent / resend, stale through the layers below', () => {
  assert.deepEqual(exportStates(['a', '', 'r'], null), ['ready', 'empty', 'ready'])
  assert.deepEqual(exportStates(['a', '', 'r'], ['a', '', 'r']), ['sent', 'empty', 'sent'])
  assert.deepEqual(exportStates(['a', 'w', 'r2'], ['a', '', 'r']), ['sent', 'ready', 'resend'])
  // relief changed: the roads built on it must be sent again
  assert.deepEqual(exportStates(['b', '', 'r'], ['a', '', 'r'], [[], [0], [0]]), ['resend', 'empty', 'resend'])
})
