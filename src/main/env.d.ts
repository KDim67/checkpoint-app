/** vite hands back a file's text for ?raw; electron-vite's node types don't declare it */
declare module '*?raw' {
  const text: string
  export default text
}
