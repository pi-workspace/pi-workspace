'use client'

import * as Headless from '@headlessui/react'
import { Menu, X } from 'lucide-react'
import React, { useRef, useState } from 'react'
import { NavbarItem } from '@/components/ui-kit/navbar'
import {
  adjustSidebarWidth,
  clampSidebarWidth,
  maximumSidebarWidth,
  minimumSidebarWidth,
} from '@/src/renderer/sidebar-width'

const defaultSidebarWidth = 320
const sidebarWidthStep = 16

function MobileSidebar({ open, close, children }: React.PropsWithChildren<{ open: boolean; close: () => void }>) {
  return (
    <Headless.Dialog open={open} onClose={close} className="lg:hidden">
      <Headless.DialogBackdrop
        transition
        className="fixed inset-0 bg-overlay-background transition data-closed:opacity-0 data-enter:duration-300 data-enter:ease-out data-leave:duration-200 data-leave:ease-in"
      />
      <Headless.DialogPanel
        transition
        className="fixed inset-y-0 w-full max-w-80 p-2 transition duration-300 ease-in-out data-closed:-translate-x-full"
      >
        <div className="flex h-full flex-col rounded-lg bg-sidebar shadow-xs ring-1 ring-content-border">
          <div className="-mb-3 px-4 pt-3">
            <Headless.CloseButton as={NavbarItem} aria-label="Close navigation">
              <X aria-hidden="true" data-slot="icon" />
            </Headless.CloseButton>
          </div>
          {children}
        </div>
      </Headless.DialogPanel>
    </Headless.Dialog>
  )
}

export function SidebarLayout({ sidebar, children }: React.PropsWithChildren<{ sidebar: React.ReactNode }>) {
  const [showSidebar, setShowSidebar] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(defaultSidebarWidth)
  const [isResizing, setIsResizing] = useState(false)
  const resizeStart = useRef<{ pointerId: number; x: number; width: number } | undefined>(undefined)

  function finishResizing(pointerId: number) {
    if (resizeStart.current?.pointerId !== pointerId) {
      return
    }

    resizeStart.current = undefined
    setIsResizing(false)
  }

  function handleResizeStart(event: React.PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary) {
      return
    }

    event.preventDefault()
    resizeStart.current = { pointerId: event.pointerId, x: event.clientX, width: sidebarWidth }
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsResizing(true)
  }

  function handleResize(event: React.PointerEvent<HTMLDivElement>) {
    const start = resizeStart.current

    if (!start || start.pointerId !== event.pointerId) {
      return
    }

    setSidebarWidth(clampSidebarWidth(start.width + event.clientX - start.x))
  }

  function handleResizeEnd(event: React.PointerEvent<HTMLDivElement>) {
    finishResizing(event.pointerId)

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function handleResizeKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault()
        setSidebarWidth((width) => adjustSidebarWidth(width, -sidebarWidthStep))
        break
      case 'ArrowRight':
        event.preventDefault()
        setSidebarWidth((width) => adjustSidebarWidth(width, sidebarWidthStep))
        break
      case 'Home':
        event.preventDefault()
        setSidebarWidth(minimumSidebarWidth)
        break
      case 'End':
        event.preventDefault()
        setSidebarWidth(maximumSidebarWidth)
        break
    }
  }

  return (
    <div
      className="relative isolate flex h-svh w-full overflow-hidden bg-sidebar max-lg:flex-col"
      style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
    >
      {/* Sidebar on desktop */}
      <div className="fixed inset-y-0 left-0 max-lg:hidden lg:w-[var(--sidebar-width)]">
        {sidebar}
        <div
          role="separator"
          aria-label="Resize sidebar"
          aria-orientation="vertical"
          aria-valuemin={minimumSidebarWidth}
          aria-valuemax={maximumSidebarWidth}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          className="absolute inset-y-0 -right-2 z-10 w-4 touch-none cursor-col-resize before:absolute before:inset-y-0 before:left-1/2 before:w-px before:bg-sidebar-border focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring"
          data-resizing={isResizing ? 'true' : undefined}
          onPointerDown={handleResizeStart}
          onPointerMove={handleResize}
          onPointerUp={handleResizeEnd}
          onPointerCancel={handleResizeEnd}
          onLostPointerCapture={(event) => finishResizing(event.pointerId)}
          onKeyDown={handleResizeKeyDown}
        />
      </div>

      {/* Sidebar on mobile */}
      <MobileSidebar open={showSidebar} close={() => setShowSidebar(false)}>
        {sidebar}
      </MobileSidebar>

      {/* Navbar on mobile */}
      <header className="flex items-center px-4 lg:hidden">
        <div className="py-2.5">
          <NavbarItem onClick={() => setShowSidebar(true)} aria-label="Open navigation">
            <Menu aria-hidden="true" data-slot="icon" />
          </NavbarItem>
        </div>
      </header>

      {/* Content */}
      <main className="flex min-h-0 flex-1 flex-col lg:min-w-0 lg:pl-[var(--sidebar-width)]">{children}</main>
    </div>
  )
}
