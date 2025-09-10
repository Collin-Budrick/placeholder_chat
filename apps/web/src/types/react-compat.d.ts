// TypeScript shims to map React typings to Preact when using preact/compat
// This avoids requiring @types/react and @types/react-dom.
declare module 'react' {
  export * from 'preact/compat';
  import compat from 'preact/compat';
  export default compat;
}

declare module 'react-dom' {
  export * from 'preact/compat';
  import compat from 'preact/compat';
  export default compat;
}

declare module 'react/jsx-runtime' {
  export * from 'preact/jsx-runtime';
}

