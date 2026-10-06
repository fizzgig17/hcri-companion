// src/components/PagerLock.ts
//
// Lets a chart inside SwipablePages temporarily switch the pager's horizontal
// swiping off while the person is dragging something on the chart (the
// spectrum's red wavelength line), so the drag isn't also read as a swipe.

import { createContext } from 'react';

export const PagerLockContext = createContext<(locked: boolean) => void>(() => {});
