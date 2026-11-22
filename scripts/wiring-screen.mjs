// Print one screen (and optionally global rules) from the wiring file, so nobody has to read all of it.
// Usage: node scripts/wiring-screen.mjs 25            -> screen 25: name, control summary, all rules, wide entry
//        node scripts/wiring-screen.mjs 32 person_row  -> also rules_global.person_row
//        node scripts/wiring-screen.mjs --globals      -> list rules_global keys
import fs from 'node:fs'
const file = fs.existsSync('docs/handoff/journey-wiring.json') ? 'docs/handoff/journey-wiring.json' : 'src/pos/wiring.json'
const w = JSON.parse(fs.readFileSync(file, 'utf8'))
const args = process.argv.slice(2)
if (!args.length) { console.log('Usage: node scripts/wiring-screen.mjs <screen id> [rules_global key ...] | --globals'); process.exit(1) }
if (args[0] === '--globals') { console.log(Object.keys(w.rules_global).join('\n')); process.exit(0) }
const [id, ...keys] = args
const s = w.screens[id]
if (!s) { console.log('No screen', id, '. Known:', Object.keys(w.screens).join(', ')); process.exit(1) }
console.log(`# Screen ${id}: ${s.name} (${s.component})`)
console.log('\n## Controls')
for (const c of s.controls || []) console.log(`- ${c.label} [${c.type}${c.to ? ' -> ' + c.to : ''}]${c.disabled_initially ? ' (disabled at start)' : ''}`)
console.log('\n## Rules')
for (const r of s.rules || []) console.log('- ' + r)
const wide = w.rules_global.wide_layout?.screens || {}
for (const k of Object.keys(wide)) if (k.split(/[ ,]+/).includes(id) || k.startsWith(id + ' ')) console.log(`\n## Wide layout (${k})\n${wide[k]}`)
for (const k of keys) {
  if (!(k in w.rules_global)) { console.log(`\n## rules_global.${k}: not found`); continue }
  console.log(`\n## rules_global.${k}\n${JSON.stringify(w.rules_global[k], null, 1)}`)
}
