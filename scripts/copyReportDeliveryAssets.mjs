import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const root = process.cwd()
const source = join(root, 'src', 'modules', 'reportDelivery', 'assets', 'cwi-logo.svg')
const target = join(root, 'dist', 'modules', 'reportDelivery', 'assets', 'cwi-logo.svg')
mkdirSync(dirname(target), { recursive: true })
copyFileSync(source, target)
