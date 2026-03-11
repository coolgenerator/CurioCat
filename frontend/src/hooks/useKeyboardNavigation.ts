import { useEffect, useCallback } from 'react'
import { useAnalysis } from '../context/AnalysisContext.tsx'
import type { CausalGraph, CausalNode } from '../types/graph.ts'

interface KeyboardNavigationOptions {
  enabled?: boolean
  onZoomIn?: () => void
  onZoomOut?: () => void
}

export function useKeyboardNavigation(
  graph: CausalGraph | null,
  options: KeyboardNavigationOptions = {},
) {
  const { state, dispatch } = useAnalysis()
  const { enabled = true, onZoomIn, onZoomOut } = options

  const getParentChildMap = useCallback(() => {
    if (!graph) return { parentsMap: new Map<string, string[]>(), childrenMap: new Map<string, string[]>() }

    const parentsMap = new Map<string, string[]>()
    const childrenMap = new Map<string, string[]>()

    for (const edge of graph.edges) {
      const parents = parentsMap.get(edge.targetId) ?? []
      parents.push(edge.sourceId)
      parentsMap.set(edge.targetId, parents)
      const children = childrenMap.get(edge.sourceId) ?? []
      children.push(edge.targetId)
      childrenMap.set(edge.sourceId, children)
    }

    return { parentsMap, childrenMap }
  }, [graph])

  const getSiblings = useCallback((nodeId: string): string[] => {
    if (!graph) return []
    const { parentsMap, childrenMap } = getParentChildMap()
    const parents = parentsMap.get(nodeId) ?? []
    if (parents.length === 0) return []
    // Aggregate siblings from all parents, deduplicated
    const siblingSet = new Set<string>()
    for (const pid of parents) {
      for (const childId of childrenMap.get(pid) ?? []) {
        siblingSet.add(childId)
      }
    }
    return [...siblingSet]
  }, [graph, getParentChildMap])

  const getRootNode = useCallback((): CausalNode | null => {
    if (!graph || graph.nodes.length === 0) return null
    const incomingTargets = new Set(graph.edges.map((e) => e.targetId))
    const root = graph.nodes.find((n) => !incomingTargets.has(n.id))
    return root ?? graph.nodes[0]
  }, [graph])

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabled || !graph) return

    // Don't handle keyboard events when typing in inputs
    const target = event.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return
    }

    const { parentsMap, childrenMap } = getParentChildMap()
    const selectedNodeId = state.selectedNodeId

    switch (event.key) {
      case 'ArrowUp': {
        event.preventDefault()
        if (!selectedNodeId) {
          const root = getRootNode()
          if (root) dispatch({ type: 'SELECT_NODE', nodeId: root.id })
          return
        }
        // Navigate to first parent (multi-parent: takes first)
        const parents = parentsMap.get(selectedNodeId) ?? []
        if (parents.length > 0) {
          dispatch({ type: 'SELECT_NODE', nodeId: parents[0] })
        }
        break
      }

      case 'ArrowDown': {
        event.preventDefault()
        if (!selectedNodeId) {
          const root = getRootNode()
          if (root) dispatch({ type: 'SELECT_NODE', nodeId: root.id })
          return
        }
        // Navigate to first child
        const children = childrenMap.get(selectedNodeId)
        if (children && children.length > 0) {
          dispatch({ type: 'SELECT_NODE', nodeId: children[0] })
        }
        break
      }

      case 'ArrowLeft': {
        event.preventDefault()
        if (!selectedNodeId) return
        // Navigate to previous sibling
        const siblings = getSiblings(selectedNodeId)
        const currentIndex = siblings.indexOf(selectedNodeId)
        if (currentIndex > 0) {
          dispatch({ type: 'SELECT_NODE', nodeId: siblings[currentIndex - 1] })
        }
        break
      }

      case 'ArrowRight': {
        event.preventDefault()
        if (!selectedNodeId) return
        // Navigate to next sibling
        const siblings = getSiblings(selectedNodeId)
        const currentIndex = siblings.indexOf(selectedNodeId)
        if (currentIndex >= 0 && currentIndex < siblings.length - 1) {
          dispatch({ type: 'SELECT_NODE', nodeId: siblings[currentIndex + 1] })
        }
        break
      }

      case 'Enter': {
        // Select/expand current node (already selected via dispatch)
        if (selectedNodeId) {
          event.preventDefault()
          // Re-dispatch to toggle
          dispatch({ type: 'SELECT_NODE', nodeId: selectedNodeId })
        }
        break
      }

      case 'Escape': {
        event.preventDefault()
        dispatch({ type: 'SELECT_NODE', nodeId: null })
        dispatch({ type: 'SELECT_EDGE', edgeId: null })
        break
      }

      case '+':
      case '=': {
        if (!event.ctrlKey && !event.metaKey) {
          event.preventDefault()
          onZoomIn?.()
        }
        break
      }

      case '-':
      case '_': {
        if (!event.ctrlKey && !event.metaKey) {
          event.preventDefault()
          onZoomOut?.()
        }
        break
      }
    }
  }, [enabled, graph, state.selectedNodeId, dispatch, getParentChildMap, getSiblings, getRootNode, onZoomIn, onZoomOut])

  useEffect(() => {
    if (!enabled) return
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [enabled, handleKeyDown])
}
