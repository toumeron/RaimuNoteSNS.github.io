import { defineConfig, devices } from '@playwright/test';
import topics from '../topics/topics.config';

export default defineConfig({
  ...topics,
  testDir: '../topics',
  grep: /settings groups|profile editor opens/,
  projects: [...topics.projects!, { name: 'iPad', use: { ...devices['iPad Mini'], browserName: 'webkit' } }],
});
