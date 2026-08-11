import { readFileSync, writeFileSync } from 'node:fs'

export function extractAwsInstances(rawIndex) {
  const [region] = Object.keys(rawIndex.regions)
  const rows = Object.values(rawIndex.regions[region])
  const operatingSystem = rows[0]['Operating System']

  const instances = rows.map((row) => ({
    'Instance Type': row['Instance Type'],
    'Instance Family': row['Instance Family'],
    vCPU: row['vCPU'],
    Memory: row['Memory'],
    Storage: row['Storage'],
    'Network Performance': row['Network Performance'],
    price: row['price'],
  }))

  return { region, operatingSystem, instances }
}

function main() {
  const rawIndex = JSON.parse(readFileSync('fixtures/aws/index.json', 'utf8'))
  const result = extractAwsInstances(rawIndex)

  writeFileSync('fixtures/aws/instances.json', JSON.stringify(result, null, 2) + '\n')

  console.log(`region: ${result.region}`)
  console.log(`operatingSystem: ${result.operatingSystem}`)
  console.log(`instances: ${result.instances.length} rows`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
