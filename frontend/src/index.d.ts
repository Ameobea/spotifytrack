type dispatch = (action: { type: string; [key: string]: any }) => void;

declare module 'react-redux' {
  export function useSelector<S, T>(selector: (state: S) => T): T;

  export function useDispatch(): dispatch;
}
