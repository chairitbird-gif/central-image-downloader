const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const clientDir = path.join(root, 'client');
const changelogPath = path.join(__dirname, 'changelog.json');

function main() {
  const changelog = JSON.parse(fs.readFileSync(changelogPath, 'utf8'));
  const latest = changelog[0] || {
    version: 'beta 1.0',
    date: new Date().toISOString().slice(0, 10),
    changes: [],
  };
  let hash = 'dev';
  try {
    hash = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
  } catch (error) {}

  const version = {
    version: latest.version,
    date: latest.date,
    hash,
    renderer: 'browser',
    changes: latest.changes || [],
    changelog,
  };
  const json = JSON.stringify(version, null, 2) + '\n';
  fs.writeFileSync(path.join(clientDir, 'version.json'), json, 'utf8');

  const indexPath = path.join(clientDir, 'index.html');
  const index = fs.readFileSync(indexPath, 'utf8');
  const inline = JSON.stringify(version).replace(/</g, '\\u003c');
  const next = index.replace(
    /(<script id="cid-version-data" type="application\/json">)[\s\S]*?(<\/script>)/,
    `$1${inline}$2`,
  );
  if (next === index) throw new Error('cid-version-data marker not found');
  fs.writeFileSync(indexPath, next, 'utf8');
  console.log(`Version ${latest.version} (${hash})`);
}

main();
