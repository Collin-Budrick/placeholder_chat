/**
 * Simple CI check to ensure plugin@auth.ts doesn't enable debug in production.
 * Exits with a non-zero code if unsafe patterns are found.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, '..', 'src', 'routes', 'plugin@auth.ts');
const text = fs.readFileSync(FILE, 'utf8');

const unsafePatterns = [
  /debug\s*:\s*true/,
  /debug\s*:\s*['"]true['"]/,
  /debug\s*:\s*!{2}import\.meta\.env\.DEV/ // allow this pattern but keep in list for review
];

let found = false;
unsafePatterns.forEach((re) => {
  if (re.test(text) && re.toString().indexOf('import.meta.env.DEV') === -1) {
    console.error('CI CHECK FAILED: Found unsafe auth debug pattern:', re);
    found = true;
  }
});

if (found) {
  console.error('plugin@auth.ts appears to enable debug in production. Please gate debug behind import.meta.env.DEV.');
  process.exit(2);
} else {
  console.log('CI CHECK PASSED: No unsafe auth debug patterns found.');
  process.exit(0);
}
