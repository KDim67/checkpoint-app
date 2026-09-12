import { describe, it, expect } from 'vitest'
import { texturePathsIn } from '../src/shared/texturePaths'

describe('texturePathsIn', () => {
  it('finds a drive path to an image, with forward slashes', () => {
    expect(texturePathsIn('Albedo is at C:\\art\\rock.png')).toEqual(['C:/art/rock.png'])
  })

  it('reads a file:/// link, whatever the case of the extension', () => {
    expect(texturePathsIn('[wall](file:///D:/tex/wall.TGA)')).toEqual(['D:/tex/wall.TGA'])
  })

  it('names each file once, however it was written', () => {
    expect(texturePathsIn('C:\\art\\rock.png\nC:/art/rock.png')).toEqual(['C:/art/rock.png'])
  })

  it('keeps the order the files first appear in', () => {
    expect(texturePathsIn('see D:\\b\\two.webp\nthen C:\\a\\one.jpg')).toEqual(['D:/b/two.webp', 'C:/a/one.jpg'])
  })

  it('keeps a path with spaces in it whole', () => {
    expect(texturePathsIn('C:\\My Art\\stone wall.jpeg')).toEqual(['C:/My Art/stone wall.jpeg'])
  })

  it('ignores files that are not images, and paths without a drive', () => {
    expect(texturePathsIn('C:\\docs\\notes.txt')).toEqual([])
    expect(texturePathsIn('/home/me/rock.png and art/rock.png')).toEqual([])
    expect(texturePathsIn('')).toEqual([])
  })
})
