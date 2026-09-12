/**
 * The local texture files a piece of text names.
 *
 * Windows drive paths, written bare or as file:/// links, ending in an image
 * extension. Each comes back once, with forward slashes, in the order it first
 * appears.
 */
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
