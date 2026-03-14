declare module 'cm-chessboard' {
  export const COLOR: { white: string; black: string };
  export const FEN: { start: string; empty: string };
  export const INPUT_EVENT_TYPE: {
    moveInputStarted: string;
    validateMoveInput: string;
    moveInputCanceled: string;
    moveInputFinished: string;
  };
  export class Chessboard {
    constructor(element: HTMLElement, config?: any);
    setPosition(fen: string, animated?: boolean): Promise<void>;
    getPosition(): string;
    setOrientation(color: string): void;
    enableMoveInput(callback: (event: any) => any, color?: string): void;
    disableMoveInput(): void;
    addMarker(type: any, square: string): void;
    removeMarkers(type?: any, square?: string): void;
    destroy(): void;
  }
}

declare module 'cm-chessboard/src/extensions/markers/Markers.js' {
  export const MARKER_TYPE: {
    dot: any;
    framePrimary: any;
    frame: any;
    square: any;
    circle: any;
  };
  export class Markers {
    constructor(chessboard: any, props?: any);
  }
}
