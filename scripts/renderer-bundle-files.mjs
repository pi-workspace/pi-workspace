export function identifyRendererBundleFiles(files) {
  const assets = files.filter((path) => /[\\/]assets[\\/]/.test(path))
  const javascriptAssets = assets.filter((path) => path.endsWith('.js'))
  const entry = javascriptAssets.find((path) => /[\\/]index-[^\\/]+\.js$/.test(path))

  return { assets, entry }
}
