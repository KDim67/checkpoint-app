/** windows drive paths, bare or file:///, image extensions; forward slashes, first-seen order, once each */
export function texturePathsIn(text: string): string[] {
  const regex = /(?:file:\/\/\/)?([a-zA-Z]:[\\/][^:\r\n"']+\.(?:png|jpg|jpeg|tga|bmp|webp))/gi
  const paths: string[] = []
  let match
  while ((match = regex.exec(text)) !== null) {
    const cleanPath = match[1].replace(/\\/g, '/')
    if (!paths.includes(cleanPath)) {
      paths.push(cleanPath)
    }
  }
  return paths
}
