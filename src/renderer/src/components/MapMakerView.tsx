//  MAP MAKER, Pre-production 2D level layout tool
//  Zones, Terrain, Objects, Paths, Annotations, and JSON/PNG export.

import React, {
  useState, useCallback, useEffect, useRef, useMemo, useId
} from 'react'
import {
  Map, Layers, Eye, EyeOff, Lock, Unlock, Copy, Trash2, Plus, Download,
  Upload, ChevronDown, ChevronRight, Pencil, Square, Circle, Triangle,
  MousePointer, Pipette, PaintBucket, Eraser, Minus, Settings, X, Check,
  AlertTriangle, FileJson, Image, Code, RotateCcw, RotateCw, ZoomIn, ZoomOut,
  Maximize, Crosshair, Move, GitFork, Star, Home, Package, Swords, Shield,
  BookOpen, Droplets, Flag, RefreshCw, Camera, MessageSquare
} from 'lucide-react'

// Types

type GridType = 'square' | 'hex' | 'isometric'
type LayerType = 'reference' | 'terrain' | 'zones' | 'objects' | 'paths' | 'annotations'
type ZoneShapeType = 'polygon' | 'rect' | 'ellipse'
type ToolId =
  | 'select' | 'brush' | 'rect' | 'ellipse' | 'polygon' | 'bucket'
  | 'eraser' | 'eyedropper' | 'magic_wand'
  | 'stamp' | 'scatter' | 'move' | 'delete_obj'
  | 'pen' | 'delete_node'
  | 'comment_pin'

interface MapSettings {
  mapId: string
  name: string
  gridType: GridType
  cellSize: number
  scaleLabel: string
  width: number
  height: number
  locked: boolean
}

interface LayerDef {
  id: string
  name: string
  type: LayerType
  visible: boolean
  locked: boolean
  opacity: number
}

interface TerrainCell {
  col: number
  row: number
  /** for hex grids, col=q and row=r (axial coordinates) */
  type: string
}

interface ZoneDef {
  id: string
  type: string
  name: string
  color: string
  shape: ZoneShapeType
  points: [number, number][]
  properties: Record<string, string>
}

interface MapObject {
  id: string
  type: string
  x: number
  y: number
  rotation: number
  scale: number
  properties: Record<string, string>
}

interface MapPath {
  id: string
  type: string
  points: [number, number][]
  properties: Record<string, string>
}

interface MapComment {
  id: string
  text: string
  x: number
  y: number
}

interface ZonePaletteEntry {
  id: string
  type: string
  name: string
  color: string
  defaultProperties: Record<string, string>
}

interface Checkpoint {
  id: string
  label: string
  timestamp: number
  snapshot: string
}

interface MapState {
  settings: MapSettings
  layers: LayerDef[]
  terrain: TerrainCell[]
  zones: ZoneDef[]
  objects: MapObject[]
  paths: MapPath[]
  comments: MapComment[]
}

// Default zone palette

const DEFAULT_ZONE_PALETTE: ZonePaletteEntry[] = [
  { id: 'zp_combat',    type: 'combat',    name: 'Combat',         color: '#E63946', defaultProperties: { difficulty: 'normal' } },
  { id: 'zp_safe',      type: 'safe',      name: 'Safe / Rest',    color: '#2DC653', defaultProperties: { respawn: 'true' } },
  { id: 'zp_puzzle',    type: 'puzzle',    name: 'Puzzle',         color: '#F4A261', defaultProperties: {} },
  { id: 'zp_loot',      type: 'loot',      name: 'Loot',           color: '#FFD166', defaultProperties: { tier: '1' } },
  { id: 'zp_boss',      type: 'boss',      name: 'Boss',           color: '#9B5DE5', defaultProperties: { difficulty: 'hard', music_cue: 'boss_theme' } },
  { id: 'zp_spawn',     type: 'spawn',     name: 'Spawn',          color: '#00B4D8', defaultProperties: {} },
  { id: 'zp_water',     type: 'water',     name: 'Water',          color: '#0077B6', defaultProperties: { traversable: 'swimming' } },
  { id: 'zp_narrative', type: 'narrative', name: 'Narrative',      color: '#A8DADC', defaultProperties: { trigger_event: '' } },
  { id: 'zp_restricted',type: 'restricted',name: 'Restricted',     color: '#D62828', defaultProperties: { reason: 'out_of_bounds' } },
  { id: 'zp_custom',    type: 'custom',    name: 'Custom',         color: '#8338EC', defaultProperties: {} },
]

const TERRAIN_TYPES = ['grass', 'water', 'sand', 'rock', 'dirt', 'snow', 'lava', 'void']
const TERRAIN_COLORS: Record<string, string> = {
  grass: '#3a7d44', water: '#1a78c2', sand: '#c9a84c', rock: '#7a7a7a',
  dirt: '#8b5e3c', snow: '#d6eaf8', lava: '#e74c3c', void: '#1a1a2e'
}

const OBJECT_TYPES = [
  { id: 'spawn_point', label: 'Spawn', icon: '⭐', color: '#00B4D8' },
  { id: 'boss',        label: 'Boss',  icon: '💀', color: '#9B5DE5' },
  { id: 'chest',       label: 'Chest', icon: '📦', color: '#FFD166' },
  { id: 'npc',         label: 'NPC',   icon: '🧑', color: '#2DC653' },
  { id: 'portal',      label: 'Portal',icon: '🌀', color: '#F4A261' },
  { id: 'enemy',       label: 'Enemy', icon: '⚔️', color: '#E63946' },
  { id: 'camera',      label: 'Camera',icon: '📷', color: '#A8DADC' },
  { id: 'marker',      label: 'Marker',icon: '📍', color: '#FF6B6B' },
]

// Layer tools mapping

const LAYER_TOOLS: Record<LayerType, ToolId[]> = {
  reference:   [],
  terrain:     ['brush', 'rect', 'ellipse', 'bucket', 'eraser', 'magic_wand', 'eyedropper'],
  zones:       ['select', 'brush', 'polygon', 'rect', 'ellipse', 'eyedropper'],
  objects:     ['select', 'stamp', 'scatter', 'delete_obj'],
  paths:       ['select', 'pen', 'delete_node'],
  annotations: ['comment_pin', 'move', 'delete_obj'],
}

// ID generation

let _idCounter = 1
const genId = (prefix: string) => `${prefix}_${Date.now()}_${_idCounter++}`

// Default map state

const makeDefaultMap = (settings: MapSettings): MapState => ({
  settings,
  layers: [
    { id: 'l_ref',   name: 'Reference',   type: 'reference',   visible: true,  locked: false, opacity: 0.5 },
    { id: 'l_terrain',name: 'Terrain',    type: 'terrain',     visible: true,  locked: false, opacity: 1.0 },
    { id: 'l_zones', name: 'Zones',       type: 'zones',       visible: true,  locked: false, opacity: 0.65 },
    { id: 'l_obj',   name: 'Objects',     type: 'objects',     visible: true,  locked: false, opacity: 1.0 },
    { id: 'l_paths', name: 'Paths',       type: 'paths',       visible: true,  locked: false, opacity: 0.9 },
    { id: 'l_ann',   name: 'Annotations', type: 'annotations', visible: true,  locked: false, opacity: 1.0 },
  ],
  terrain: [],
  zones: [],
  objects: [],
  paths: [],
  comments: [],
})

// Unity C# importer generator

function generateUnityScript(): string {
  return `//
// MapMakerImporter.cs, generated by Map Maker (Checkpoint App)
// Drop this file anywhere inside your Unity project's Assets/ folder.
// Usage: Edit menu → Map Maker → Import Map JSON
#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;
using UnityEditor;

public class MapMakerImporter : EditorWindow
{
    [Serializable] class MapRoot   { public string mapId; public string name; public float cellSize; public float width; public float height; public List<ZoneData> zones; public List<ObjData> objects; public List<PathData> paths; }
    [Serializable] class ZoneData  { public string id; public string type; public string name; public string color; public List<List<float>> points; public Dictionary<string,string> properties; }
    [Serializable] class ObjData   { public string id; public string type; public float x; public float y; public float rotation; public float scale; public Dictionary<string,string> properties; }
    [Serializable] class PathData  { public string id; public string type; public List<List<float>> points; public Dictionary<string,string> properties; }

    public float scaleFactor = 100f;   // pixels per Unity world unit
    public bool  idMatchMode = false;  // false = clear-and-rebuild (default)
    public List<PrefabMapping> prefabMappings = new List<PrefabMapping>();

    [Serializable]
    public class PrefabMapping { public string objectType; public GameObject prefab; }

    string jsonPath = "";

    [MenuItem("Window/Map Maker/Import Map JSON")]
    public static void ShowWindow() => GetWindow<MapMakerImporter>("Map Maker Import");

    void OnGUI()
    {
        GUILayout.Label("Map Maker Importer", EditorStyles.boldLabel);
        EditorGUILayout.Space();

        GUILayout.BeginHorizontal();
        jsonPath = EditorGUILayout.TextField("JSON Path", jsonPath);
        if (GUILayout.Button("Browse", GUILayout.Width(60)))
            jsonPath = EditorUtility.OpenFilePanel("Select Map JSON", "", "json");
        GUILayout.EndHorizontal();

        scaleFactor = EditorGUILayout.FloatField("Scale Factor (px / unit)", scaleFactor);
        idMatchMode = EditorGUILayout.Toggle("ID-Match Mode (preserve tweaks)", idMatchMode);

        EditorGUILayout.Space();
        if (GUILayout.Button("Import Map", GUILayout.Height(36)))
            Import();
    }

    void Import()
    {
        if (!File.Exists(jsonPath)) { Debug.LogError("[MapMaker] JSON file not found: " + jsonPath); return; }
        var raw = File.ReadAllText(jsonPath);
        var map = JsonUtility.FromJson<MapRoot>(raw);

        // --- 1. Find or create root container ---
        string rootName = "MapMaker_" + map.mapId;
        var root = GameObject.Find(rootName);
        if (!idMatchMode && root != null) { DestroyImmediate(root); root = null; }
        if (root == null) root = new GameObject(rootName);

        float canvasH = map.height;

        // Helper: canvas px → Unity world (Y flipped)
        Vector2 ToUnity(float cx, float cy) => new Vector2(cx / scaleFactor, (canvasH - cy) / scaleFactor);
        // Zones points list
        Vector2[] ToUnityPoints(List<List<float>> pts) {
            var arr = new Vector2[pts.Count];
            for (int i = 0; i < pts.Count; i++) arr[i] = ToUnity(pts[i][0], pts[i][1]);
            return arr;
        }

        // --- 2. Zones → trigger colliders ---
        var zonesGO = GetOrCreateChild(root, "Zones", idMatchMode);
        foreach (var z in map.zones ?? new List<ZoneData>())
        {
            string goName = "Zone_" + z.id;
            var go = idMatchMode ? FindOrCreateChild(zonesGO, goName) : new GameObject(goName);
            go.transform.SetParent(zonesGO.transform, false);

            var pts = ToUnityPoints(z.points);
            if (pts.Length == 4 && IsRect(pts))
            {
                var col = go.GetOrAddComponent<BoxCollider2D>();
                col.isTrigger = true;
                var min = pts[0]; var max = pts[2];
                col.offset = (min + max) / 2f;
                col.size   = new Vector2(Mathf.Abs(max.x - min.x), Mathf.Abs(max.y - min.y));
            }
            else
            {
                var col = go.GetOrAddComponent<PolygonCollider2D>();
                col.isTrigger = true;
                col.SetPath(0, pts);
            }

            var meta = go.GetOrAddComponent<ZoneMetadata>();
            meta.zoneId   = z.id;
            meta.zoneName = z.name;
            meta.zoneType = z.type;
            if (z.properties != null)
                foreach (var kv in z.properties) meta.SetProperty(kv.Key, kv.Value);

            EditorUtility.SetDirty(go);
        }

        // --- 3. Objects → prefabs or placeholders ---
        var objsGO = GetOrCreateChild(root, "Objects", idMatchMode);
        foreach (var o in map.objects ?? new List<ObjData>())
        {
            string goName = "Obj_" + o.id;
            var go = idMatchMode ? FindOrCreateChild(objsGO, goName) : null;
            if (go == null)
            {
                var pref = prefabMappings?.Find(m => m.objectType == o.type)?.prefab;
                go = pref != null ? (GameObject)PrefabUtility.InstantiatePrefab(pref, objsGO.transform)
                                  : new GameObject(goName);
            }
            go.name = goName;
            go.transform.SetParent(objsGO.transform, false);
            go.transform.localPosition = new Vector3(ToUnity(o.x, o.y).x, ToUnity(o.x, o.y).y, 0f);
            // Canvas rotation is clockwise degrees; Unity 2D is CCW
            go.transform.localRotation = Quaternion.Euler(0f, 0f, -o.rotation);
            go.transform.localScale    = new Vector3(o.scale, o.scale, 1f);
            EditorUtility.SetDirty(go);
        }

        // --- 4. Paths → LineRenderers ---
        var pathsGO = GetOrCreateChild(root, "Paths", idMatchMode);
        foreach (var p in map.paths ?? new List<PathData>())
        {
            string goName = "Path_" + p.id;
            var go = idMatchMode ? FindOrCreateChild(pathsGO, goName) : new GameObject(goName);
            go.name = goName;
            go.transform.SetParent(pathsGO.transform, false);
            var lr = go.GetOrAddComponent<LineRenderer>();
            lr.positionCount = p.points.Count;
            for (int i = 0; i < p.points.Count; i++)
            {
                var uv = ToUnity(p.points[i][0], p.points[i][1]);
                lr.SetPosition(i, new Vector3(uv.x, uv.y, 0f));
            }
            lr.useWorldSpace = false;
            EditorUtility.SetDirty(go);
        }

        EditorUtility.SetDirty(root);
        Selection.activeGameObject = root;
        Debug.Log($"[MapMaker] Imported map '{map.name}' → '{rootName}'");
    }

    static bool IsRect(Vector2[] pts) => pts.Length == 4;

    static GameObject GetOrCreateChild(GameObject parent, string name, bool preserve)
    {
        if (!preserve) return new GameObject(name) { transform = { parent = parent.transform } };
        var t = parent.transform.Find(name);
        if (t != null) { foreach (Transform c in t) DestroyImmediate(c.gameObject); return t.gameObject; }
        return new GameObject(name) { transform = { parent = parent.transform } };
    }

    static GameObject FindOrCreateChild(GameObject parent, string name)
    {
        var t = parent.transform.Find(name);
        return t != null ? t.gameObject : new GameObject(name) { transform = { parent = parent.transform } };
    }
}

// ZoneMetadata MonoBehaviour
public class ZoneMetadata : MonoBehaviour
{
    public string zoneId;
    public string zoneName;
    public string zoneType;
    [SerializeField] List<string> propKeys = new List<string>();
    [SerializeField] List<string> propVals = new List<string>();
    public void SetProperty(string key, string val)
    {
        int i = propKeys.IndexOf(key);
        if (i >= 0) propVals[i] = val; else { propKeys.Add(key); propVals.Add(val); }
    }
    public string GetProperty(string key)
    {
        int i = propKeys.IndexOf(key); return i >= 0 ? propVals[i] : null;
    }
}

// Extension helpers
public static class GOExtensions
{
    public static T GetOrAddComponent<T>(this GameObject go) where T : Component
        => go.GetComponent<T>() ?? go.AddComponent<T>();
}
#endif`
}

// Serializer

function serializeMap(state: MapState): string {
  const { settings, terrain, zones, objects, paths, comments } = state
  return JSON.stringify({
    mapId: settings.mapId,
    name: settings.name,
    gridType: settings.gridType,
    cellSize: settings.cellSize,
    scaleLabel: settings.scaleLabel,
    width: settings.width,
    height: settings.height,
    terrain,
    zones,
    objects,
    paths,
    comments,
  }, null, 2)
}

function deserializeMap(json: string): MapState | null {
  try {
    const d = JSON.parse(json)
    const settings: MapSettings = {
      mapId: d.mapId || genId('map'),
      name: d.name || 'Untitled Map',
      gridType: d.gridType || 'square',
      cellSize: d.cellSize || 32,
      scaleLabel: d.scaleLabel || '1 cell = 1m',
      width: d.width || 1600,
      height: d.height || 1200,
      locked: true,
    }
    return {
      settings,
      layers: makeDefaultMap(settings).layers,
      terrain: d.terrain || [],
      zones: d.zones || [],
      objects: d.objects || [],
      paths: d.paths || [],
      comments: d.comments || [],
    }
  } catch { return null }
}

// Douglas-Peucker simplification

function rdp(pts: [number, number][], eps: number): [number, number][] {
  if (pts.length < 3) return pts
  let maxD = 0, idx = 0
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1]
  const dx = bx - ax, dy = by - ay, len = Math.sqrt(dx * dx + dy * dy)
  for (let i = 1; i < pts.length - 1; i++) {
    const d = len === 0 ? Math.hypot(pts[i][0] - ax, pts[i][1] - ay)
      : Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len
    if (d > maxD) { maxD = d; idx = i }
  }
  if (maxD > eps) {
    return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)]
  }
  return [pts[0], pts[pts.length - 1]]
}

// Grid helpers

function snapToGrid(wx: number, wy: number, settings: MapSettings): [number, number] {
  const { gridType, cellSize } = settings
  if (gridType === 'square') {
    return [Math.round(wx / cellSize) * cellSize, Math.round(wy / cellSize) * cellSize]
  }
  if (gridType === 'hex') {
    // flat-topped hex: convert world → axial, round, convert back
    const q = (2 / 3 * wx) / cellSize
    const r = (-1 / 3 * wx + Math.sqrt(3) / 3 * wy) / cellSize
    const [rq, rr, rs] = hexRound(q, r)
    const sx = cellSize * 3 / 2 * rq
    const sy = cellSize * Math.sqrt(3) * (rr + rq / 2)
    return [sx, sy]
  }
  if (gridType === 'isometric') {
    const tw = cellSize * 2, th = cellSize
    const col = Math.round((wx / tw + wy / th) / 2)
    const row = Math.round((wy / th - wx / tw) / 2)
    return [(col - row) * tw / 2, (col + row) * th / 2]
  }
  return [wx, wy]
}

function hexRound(q: number, r: number): [number, number, number] {
  const s = -q - r
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s)
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s)
  if (dq > dr && dq > ds) rq = -rr - rs
  else if (dr > ds) rr = -rq - rs
  else rs = -rq - rr
  return [rq, rr, rs]
}

function worldToCell(wx: number, wy: number, settings: MapSettings): [number, number] {
  const { gridType, cellSize } = settings
  if (gridType === 'hex') {
    const q = (2 / 3 * wx) / cellSize
    const r = (-1 / 3 * wx + Math.sqrt(3) / 3 * wy) / cellSize
    const [rq, rr] = hexRound(q, r)
    return [rq, rr]
  }
  if (gridType === 'isometric') {
    const tw = cellSize * 2, th = cellSize
    return [Math.round((wx / tw + wy / th) / 2), Math.round((wy / th - wx / tw) / 2)]
  }
  return [Math.floor(wx / cellSize), Math.floor(wy / cellSize)]
}

// Canvas draw helpers

function drawGrid(ctx: CanvasRenderingContext2D, settings: MapSettings, W: number, H: number) {
  const { gridType, cellSize } = settings
  ctx.clearRect(0, 0, W, H)
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.lineWidth = 0.5

  if (gridType === 'square') {
    for (let x = 0; x <= W; x += cellSize) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
    }
    for (let y = 0; y <= H; y += cellSize) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
    }
  } else if (gridType === 'hex') {
    const r = cellSize
    const w = 2 * r, h = Math.sqrt(3) * r
    const cols = Math.ceil(W / (w * 0.75)) + 2
    const rows = Math.ceil(H / h) + 2
    for (let col = -1; col < cols; col++) {
      for (let row = -1; row < rows; row++) {
        const cx = col * w * 0.75
        const cy = row * h + (col % 2 === 0 ? 0 : h / 2)
        ctx.beginPath()
        for (let i = 0; i < 6; i++) {
          const angle = Math.PI / 180 * (60 * i)
          const vx = cx + r * Math.cos(angle)
          const vy = cy + r * Math.sin(angle)
          i === 0 ? ctx.moveTo(vx, vy) : ctx.lineTo(vx, vy)
        }
        ctx.closePath(); ctx.stroke()
      }
    }
  } else if (gridType === 'isometric') {
    const tw = cellSize * 2, th = cellSize
    const diagW = Math.ceil(W / (tw / 2)) + 4
    const diagH = Math.ceil(H / (th / 2)) + 4
    for (let i = -diagH; i < diagW + diagH; i++) {
      ctx.beginPath()
      ctx.moveTo(i * tw / 2 - diagH * tw / 2, 0)
      ctx.lineTo(i * tw / 2 + diagH * tw / 2, diagH * th)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(i * tw / 2, 0)
      ctx.lineTo(i * tw / 2 - (W + H), W + H)
      ctx.stroke()
    }
  }
}

function drawTerrainCell(
  ctx: CanvasRenderingContext2D,
  col: number, row: number,
  type: string,
  settings: MapSettings,
  opacity: number
) {
  const { gridType, cellSize } = settings
  const color = TERRAIN_COLORS[type] || '#555'
  ctx.globalAlpha = opacity
  ctx.fillStyle = color

  if (gridType === 'square') {
    ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize)
  } else if (gridType === 'hex') {
    const r = cellSize
    const w = 2 * r, h = Math.sqrt(3) * r
    const cx = col * w * 0.75
    const cy = row * h + (col % 2 === 0 ? 0 : h / 2)
    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
      const angle = Math.PI / 180 * (60 * i)
      const vx = cx + r * Math.cos(angle)
      const vy = cy + r * Math.sin(angle)
      i === 0 ? ctx.moveTo(vx, vy) : ctx.lineTo(vx, vy)
    }
    ctx.closePath(); ctx.fill()
  } else if (gridType === 'isometric') {
    const tw = cellSize * 2, th = cellSize
    const sx = (col - row) * tw / 2
    const sy = (col + row) * th / 2
    ctx.beginPath()
    ctx.moveTo(sx, sy + th / 2)
    ctx.lineTo(sx + tw / 2, sy)
    ctx.lineTo(sx + tw, sy + th / 2)
    ctx.lineTo(sx + tw / 2, sy + th)
    ctx.closePath(); ctx.fill()
  }
  ctx.globalAlpha = 1
}

function drawZone(
  ctx: CanvasRenderingContext2D,
  zone: ZoneDef,
  opacity: number,
  selected: boolean
) {
  if (zone.points.length < 2) return
  const hexColor = zone.color
  const r = parseInt(hexColor.slice(1,3),16)
  const g = parseInt(hexColor.slice(3,5),16)
  const b = parseInt(hexColor.slice(5,7),16)

  ctx.beginPath()
  if (zone.shape === 'ellipse' && zone.points.length === 2) {
    const [ax, ay] = zone.points[0], [bx, by] = zone.points[1]
    const rx = Math.abs(bx - ax) / 2, ry = Math.abs(by - ay) / 2
    ctx.ellipse(ax + (bx-ax)/2, ay + (by-ay)/2, rx, ry, 0, 0, Math.PI * 2)
  } else {
    ctx.moveTo(zone.points[0][0], zone.points[0][1])
    for (let i = 1; i < zone.points.length; i++)
      ctx.lineTo(zone.points[i][0], zone.points[i][1])
    ctx.closePath()
  }

  ctx.fillStyle = `rgba(${r},${g},${b},${opacity * 0.4})`
  ctx.fill()
  ctx.strokeStyle = selected ? '#ffffff' : `rgba(${r},${g},${b},${opacity})`
  ctx.lineWidth = selected ? 2.5 : 1.5
  ctx.stroke()

  if (selected) {
    // Draw resize/move handles on bounding box
    const xs = zone.points.map(p => p[0]), ys = zone.points.map(p => p[1])
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minY = Math.min(...ys), maxY = Math.max(...ys)
    const handles = [
      [minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY],
      [(minX+maxX)/2, minY], [(minX+maxX)/2, maxY],
      [minX, (minY+maxY)/2], [maxX, (minY+maxY)/2],
    ]
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = '#1e45fc'
    ctx.lineWidth = 1.5
    handles.forEach(([hx, hy]) => {
      ctx.beginPath()
      ctx.rect(hx - 4, hy - 4, 8, 8)
      ctx.fill(); ctx.stroke()
    })
  }
}

function drawObject(
  ctx: CanvasRenderingContext2D,
  obj: MapObject,
  selected: boolean,
  scale: number
) {
  const typeDef = OBJECT_TYPES.find(t => t.id === obj.type) || OBJECT_TYPES[7]
  const size = 20

  ctx.save()
  ctx.translate(obj.x, obj.y)
  ctx.rotate((obj.rotation * Math.PI) / 180)
  ctx.scale(obj.scale, obj.scale)

  // Background circle
  ctx.beginPath()
  ctx.arc(0, 0, size, 0, Math.PI * 2)
  ctx.fillStyle = typeDef.color + '44'
  ctx.fill()
  ctx.strokeStyle = typeDef.color
  ctx.lineWidth = 2
  ctx.stroke()

  // Icon text
  ctx.font = `${size}px serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#ffffff'
  ctx.fillText(typeDef.icon, 0, 1)

  if (selected) {
    // Selection ring
    ctx.beginPath()
    ctx.arc(0, 0, size + 6, 0, Math.PI * 2)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.setLineDash([4, 3])
    ctx.stroke()
    ctx.setLineDash([])

    // Rotate handle
    ctx.beginPath()
    ctx.moveTo(0, -(size + 6))
    ctx.lineTo(0, -(size + 18))
    ctx.strokeStyle = '#cdf12b'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(0, -(size + 18), 5, 0, Math.PI * 2)
    ctx.fillStyle = '#cdf12b'
    ctx.fill()

    // Scale handles (4 corners of bounding box)
    const hw = size + 8
    ;[[-hw,-hw],[hw,-hw],[hw,hw],[-hw,hw]].forEach(([hx,hy]) => {
      ctx.beginPath()
      ctx.rect(hx - 4, hy - 4, 8, 8)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.strokeStyle = '#1e45fc'
      ctx.lineWidth = 1.5
      ctx.stroke()
    })
  }

  ctx.restore()
}

function drawPath(
  ctx: CanvasRenderingContext2D,
  path: MapPath,
  selected: boolean
) {
  if (path.points.length < 2) return
  ctx.beginPath()
  ctx.moveTo(path.points[0][0], path.points[0][1])
  for (let i = 1; i < path.points.length; i++)
    ctx.lineTo(path.points[i][0], path.points[i][1])
  ctx.strokeStyle = selected ? '#cdf12b' : 'rgba(205,241,43,0.7)'
  ctx.lineWidth = selected ? 3 : 2
  ctx.setLineDash(selected ? [] : [8, 4])
  ctx.stroke()
  ctx.setLineDash([])

  // Node dots
  path.points.forEach(([px, py], i) => {
    ctx.beginPath()
    ctx.arc(px, py, selected ? 6 : 4, 0, Math.PI * 2)
    ctx.fillStyle = i === 0 ? '#2DC653' : (selected ? '#cdf12b' : 'rgba(205,241,43,0.7)')
    ctx.fill()
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 1
    ctx.stroke()
  })
}

function drawComment(
  ctx: CanvasRenderingContext2D,
  comment: MapComment,
  selected: boolean
) {
  const size = 18
  ctx.save()
  ctx.translate(comment.x, comment.y)

  // Pin circle
  ctx.beginPath()
  ctx.arc(0, 0, size, 0, Math.PI * 2)
  ctx.fillStyle = selected ? '#1e45fc' : 'rgba(30,69,252,0.8)'
  ctx.fill()
  ctx.strokeStyle = selected ? '#ffffff' : 'rgba(255,255,255,0.5)'
  ctx.lineWidth = 2
  ctx.stroke()

  // Comment icon
  ctx.font = `${size}px serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('💬', 0, 1)

  // Text label
  if (comment.text) {
    const label = comment.text.length > 20 ? comment.text.slice(0, 20) + '…' : comment.text
    ctx.font = '10px Inter, sans-serif'
    ctx.textAlign = 'left'
    const tw = ctx.measureText(label).width + 8
    ctx.fillStyle = 'rgba(13,16,34,0.9)'
    ctx.fillRect(size + 4, -10, tw, 20)
    ctx.fillStyle = '#f1f5f9'
    ctx.fillText(label, size + 8, 1)
  }

  ctx.restore()
}

// Point-in-polygon (ray casting)

function pointInPolygon(px: number, py: number, pts: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j]
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
      inside = !inside
  }
  return inside
}

function distPointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}

// Main Component

export default function MapMakerView() {
  // Maps & pages
  const [maps, setMaps] = useState<MapState[]>([])
  const [activeMapIdx, setActiveMapIdx] = useState(0)
  const [showNewMapWizard, setShowNewMapWizard] = useState(false)
  const [showUnityModal, setShowUnityModal] = useState(false)
  const [showCommentModal, setShowCommentModal] = useState<{x:number,y:number}|null>(null)
  const [commentDraft, setCommentDraft] = useState('')

  // Wizard form
  const [wizardName, setWizardName]         = useState('Untitled Map')
  const [wizardGrid, setWizardGrid]         = useState<GridType>('square')
  const [wizardCellSize, setWizardCellSize] = useState(32)
  const [wizardW, setWizardW]               = useState(1600)
  const [wizardH, setWizardH]               = useState(1200)
  const [wizardScale, setWizardScale]       = useState('1 cell = 1m')

  // Active state
  const activeMap = maps[activeMapIdx]
  const setActiveMap = useCallback((updater: (s: MapState) => MapState) => {
    setMaps(prev => prev.map((m, i) => i === activeMapIdx ? updater(m) : m))
  }, [activeMapIdx])

  // Layers & tools
  const [activeLayerType, setActiveLayerType] = useState<LayerType>('zones')
  const [activeTool, setActiveTool] = useState<ToolId>('select')
  const [activeZonePaletteId, setActiveZonePaletteId] = useState(DEFAULT_ZONE_PALETTE[0].id)
  const [zonePalette, setZonePalette] = useState<ZonePaletteEntry[]>(DEFAULT_ZONE_PALETTE)
  const [activeTerrainType, setActiveTerrainType] = useState('grass')
  const [activeObjectType, setActiveObjectType] = useState(OBJECT_TYPES[0].id)
  const [brushSize, setBrushSize] = useState(32)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [symmetryH, setSymmetryH] = useState(false)
  const [symmetryV, setSymmetryV] = useState(false)

  // Selection
  const [selectedZoneId, setSelectedZoneId]    = useState<string|null>(null)
  const [selectedObjectId, setSelectedObjectId]= useState<string|null>(null)
  const [selectedPathId, setSelectedPathId]    = useState<string|null>(null)
  const [selectedCommentId, setSelectedCommentId] = useState<string|null>(null)

  // Canvas view (pan/zoom)
  const [panX, setPanX] = useState(24)
  const [panY, setPanY] = useState(24)
  const [zoom, setZoom] = useState(1)
  const isPanning = useRef(false)
  const panStart = useRef({ x: 0, y: 0, px: 0, py: 0 })

  // Drawing state (mouse)
  const isDrawing = useRef(false)
  const polygonPoints = useRef<[number,number][]>([])
  const brushStroke = useRef<[number,number][]>([])
  const pathDraftPoints = useRef<[number,number][]>([])
  const dragStart = useRef<[number,number]|null>(null)
  const dragTarget = useRef<string|null>(null)

  // Canvas refs
  const containerRef   = useRef<HTMLDivElement>(null)
  const bgCanvasRef    = useRef<HTMLCanvasElement>(null)
  const terrainCanvasRef= useRef<HTMLCanvasElement>(null)
  const vectorCanvasRef= useRef<HTMLCanvasElement>(null)
  const previewCanvasRef= useRef<HTMLCanvasElement>(null)
  const gridCanvasRef  = useRef<HTMLCanvasElement>(null)

  // Undo/Redo
  const undoStack = useRef<string[]>([])
  const redoStack = useRef<string[]>([])

  // Checkpoints
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([])
  const [checkpointLabel, setCheckpointLabel] = useState('')

  // Refs for panel inspector editing
  const [inspectorKey, setInspectorKey] = useState(0)

  // Compute canvas size from map settings
  const canvasW = activeMap?.settings.width  ?? 1600
  const canvasH = activeMap?.settings.height ?? 1200

  // Convert screen → world coordinates
  const screenToWorld = useCallback((sx: number, sy: number): [number, number] => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return [0, 0]
    return [(sx - rect.left - panX) / zoom, (sy - rect.top - panY) / zoom]
  }, [panX, panY, zoom])

  // Push undo snapshot
  const pushUndo = useCallback(() => {
    if (!activeMap) return
    undoStack.current.push(serializeMap(activeMap))
    if (undoStack.current.length > 60) undoStack.current.shift()
    redoStack.current = []
  }, [activeMap])

  const undo = useCallback(() => {
    if (!undoStack.current.length || !activeMap) return
    redoStack.current.push(serializeMap(activeMap))
    const snap = undoStack.current.pop()!
    const restored = deserializeMap(snap)
    if (restored) setActiveMap(() => restored)
  }, [activeMap, setActiveMap])

  const redo = useCallback(() => {
    if (!redoStack.current.length || !activeMap) return
    undoStack.current.push(serializeMap(activeMap))
    const snap = redoStack.current.pop()!
    const restored = deserializeMap(snap)
    if (restored) setActiveMap(() => restored)
  }, [activeMap, setActiveMap])

  // Draw grid overlay
  useEffect(() => {
    const canvas = gridCanvasRef.current
    if (!canvas || !activeMap) return
    const ctx = canvas.getContext('2d')!
    drawGrid(ctx, activeMap.settings, canvasW, canvasH)
  }, [activeMap?.settings, canvasW, canvasH])

  // Redraw terrain cache
  useEffect(() => {
    const canvas = terrainCanvasRef.current
    if (!canvas || !activeMap) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvasW, canvasH)
    const terrainLayer = activeMap.layers.find(l => l.type === 'terrain')
    if (!terrainLayer?.visible) return
    activeMap.terrain.forEach(cell => {
      drawTerrainCell(ctx, cell.col, cell.row, cell.type, activeMap.settings, terrainLayer.opacity)
    })
  }, [activeMap?.terrain, activeMap?.layers, canvasW, canvasH])

  // Redraw vector canvas (zones, paths, objects, comments)
  useEffect(() => {
    const canvas = vectorCanvasRef.current
    if (!canvas || !activeMap) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvasW, canvasH)

    const layer = (type: LayerType) => activeMap.layers.find(l => l.type === type)

    const zonesLayer = layer('zones')
    if (zonesLayer?.visible) {
      activeMap.zones.forEach(z => drawZone(ctx, z, zonesLayer.opacity, z.id === selectedZoneId))
    }
    const pathsLayer = layer('paths')
    if (pathsLayer?.visible) {
      activeMap.paths.forEach(p => drawPath(ctx, p, p.id === selectedPathId))
    }
    const objsLayer = layer('objects')
    if (objsLayer?.visible) {
      activeMap.objects.forEach(o => drawObject(ctx, o, o.id === selectedObjectId, zoom))
    }
    const annLayer = layer('annotations')
    if (annLayer?.visible) {
      activeMap.comments.forEach(c => drawComment(ctx, c, c.id === selectedCommentId))
    }
  }, [activeMap, selectedZoneId, selectedPathId, selectedObjectId, selectedCommentId, canvasW, canvasH, zoom])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); undo() }
      if (e.key === 'y' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); redo() }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedZoneId) deleteZone(selectedZoneId)
        else if (selectedObjectId) deleteObject(selectedObjectId)
        else if (selectedPathId) deletePath(selectedPathId)
        else if (selectedCommentId) deleteComment(selectedCommentId)
      }
      if (e.key === 'Escape') {
        polygonPoints.current = []
        pathDraftPoints.current = []
        clearPreview()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedZoneId, selectedObjectId, selectedPathId, selectedCommentId, undo, redo])

  // Preview canvas clear
  const clearPreview = () => {
    const canvas = previewCanvasRef.current
    if (!canvas) return
    canvas.getContext('2d')!.clearRect(0, 0, canvasW, canvasH)
  }

  // Delete helpers
  const deleteZone = (id: string) => { pushUndo(); setActiveMap(s => ({ ...s, zones: s.zones.filter(z => z.id !== id) })); setSelectedZoneId(null) }
  const deleteObject = (id: string) => { pushUndo(); setActiveMap(s => ({ ...s, objects: s.objects.filter(o => o.id !== id) })); setSelectedObjectId(null) }
  const deletePath = (id: string) => { pushUndo(); setActiveMap(s => ({ ...s, paths: s.paths.filter(p => p.id !== id) })); setSelectedPathId(null) }
  const deleteComment = (id: string) => { pushUndo(); setActiveMap(s => ({ ...s, comments: s.comments.filter(c => c.id !== id) })); setSelectedCommentId(null) }

  // Mouse event handlers
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (!activeMap) return

    // Pan: space held or middle button
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      isPanning.current = true
      panStart.current = { x: e.clientX, y: e.clientY, px: panX, py: panY }
      return
    }
    if (e.button !== 0) return

    let [wx, wy] = screenToWorld(e.clientX, e.clientY)
    if (snapEnabled && activeTool !== 'select') [wx, wy] = snapToGrid(wx, wy, activeMap.settings)

    const settings = activeMap.settings

    // ZONES layer
    if (activeLayerType === 'zones') {
      if (activeTool === 'select') {
        let hit: ZoneDef | null = null
        // Hit test: iterate zones in reverse (topmost first)
        for (let i = activeMap.zones.length - 1; i >= 0; i--) {
          const z = activeMap.zones[i]
          if (z.shape === 'ellipse' && z.points.length === 2) {
            const [ax, ay] = z.points[0], [bx, by] = z.points[1]
            const rx = Math.abs(bx-ax)/2, ry = Math.abs(by-ay)/2
            const cx = ax+(bx-ax)/2, cy = ay+(by-ay)/2
            if (((wx-cx)/rx)**2 + ((wy-cy)/ry)**2 <= 1) { hit = z; break }
          } else {
            if (pointInPolygon(wx, wy, z.points)) { hit = z; break }
          }
        }
        if (hit) {
          setSelectedZoneId(hit.id)
          setInspectorKey(k => k+1)
          dragStart.current = [wx, wy]
          dragTarget.current = hit.id
          isDrawing.current = true
        } else {
          setSelectedZoneId(null)
        }
        return
      }
      if (activeTool === 'eyedropper') {
        for (let i = activeMap.zones.length - 1; i >= 0; i--) {
          const z = activeMap.zones[i]
          const match = zonePalette.find(p => p.type === z.type)
          if (match && pointInPolygon(wx, wy, z.points)) {
            setActiveZonePaletteId(match.id); break
          }
        }
        return
      }
      if (activeTool === 'polygon') {
        // Double-click to close
        if (e.detail === 2 && polygonPoints.current.length >= 3) {
          const activePalette = zonePalette.find(p => p.id === activeZonePaletteId)!
          pushUndo()
          setActiveMap(s => ({
            ...s,
            zones: [...s.zones, {
              id: genId('z'),
              type: activePalette.type,
              name: activePalette.name,
              color: activePalette.color,
              shape: 'polygon',
              points: [...polygonPoints.current],
              properties: { ...activePalette.defaultProperties }
            }]
          }))
          polygonPoints.current = []; clearPreview(); return
        }
        polygonPoints.current.push([wx, wy])
        return
      }
      if (activeTool === 'brush' || activeTool === 'rect' || activeTool === 'ellipse') {
        isDrawing.current = true
        brushStroke.current = [[wx, wy]]
        dragStart.current = [wx, wy]
        return
      }
    }

    // TERRAIN layer
    if (activeLayerType === 'terrain') {
      if (activeTool === 'eyedropper') {
        const [col, row] = worldToCell(wx, wy, settings)
        const cell = activeMap.terrain.find(c => c.col === col && c.row === row)
        if (cell) setActiveTerrainType(cell.type)
        return
      }
      if (activeTool === 'bucket') {
        // Flood fill BFS
        pushUndo()
        const [startCol, startRow] = worldToCell(wx, wy, settings)
        const target = activeMap.terrain.find(c => c.col === startCol && c.row === startRow)
        const targetType = target?.type || 'void'
        if (targetType === activeTerrainType) return
        const visited = new Set<string>()
        const queue: [number,number][] = [[startCol, startRow]]
        const newCells: TerrainCell[] = []
        while (queue.length) {
          const [col, row] = queue.shift()!
          const key = `${col},${row}`
          if (visited.has(key)) continue
          visited.add(key)
          const existing = activeMap.terrain.find(c => c.col === col && c.row === row)
          if ((existing?.type || 'void') !== targetType) continue
          if (col < 0 || row < 0 || col * settings.cellSize > canvasW || row * settings.cellSize > canvasH) continue
          newCells.push({ col, row, type: activeTerrainType })
          queue.push([col+1,row],[col-1,row],[col,row+1],[col,row-1])
        }
        setActiveMap(s => {
          const remaining = s.terrain.filter(c => !visited.has(`${c.col},${c.row}`))
          return { ...s, terrain: [...remaining, ...newCells] }
        })
        return
      }
      isDrawing.current = true
      paintTerrainAt(wx, wy)
      return
    }

    // OBJECTS layer
    if (activeLayerType === 'objects') {
      if (activeTool === 'select') {
        let hit: MapObject | null = null
        for (let i = activeMap.objects.length - 1; i >= 0; i--) {
          const o = activeMap.objects[i]
          if (Math.hypot(wx - o.x, wy - o.y) < 24 * o.scale) { hit = o; break }
        }
        if (hit) {
          setSelectedObjectId(hit.id)
          setInspectorKey(k => k+1)
          dragStart.current = [wx, wy]
          dragTarget.current = hit.id
          isDrawing.current = true
        } else setSelectedObjectId(null)
        return
      }
      if (activeTool === 'stamp' || activeTool === 'scatter') {
        pushUndo()
        const newObj: MapObject = {
          id: genId('o'),
          type: activeObjectType,
          x: wx, y: wy,
          rotation: activeTool === 'scatter' ? Math.random() * 360 : 0,
          scale: activeTool === 'scatter' ? 0.7 + Math.random() * 0.6 : 1,
          properties: {}
        }
        setActiveMap(s => ({ ...s, objects: [...s.objects, newObj] }))
        if (activeTool === 'scatter') isDrawing.current = true
        return
      }
    }

    // PATHS layer
    if (activeLayerType === 'paths') {
      if (activeTool === 'select') {
        let hit: MapPath | null = null
        for (let i = activeMap.paths.length - 1; i >= 0; i--) {
          const p = activeMap.paths[i]
          let onPath = false
          for (let j = 0; j < p.points.length - 1; j++) {
            if (distPointToSegment(wx, wy, p.points[j][0], p.points[j][1], p.points[j+1][0], p.points[j+1][1]) < 10) { onPath = true; break }
          }
          if (onPath) { hit = p; break }
        }
        if (hit) {
          setSelectedPathId(hit.id)
          setInspectorKey(k => k+1)
          dragStart.current = [wx, wy]
          dragTarget.current = hit.id
          isDrawing.current = true
        } else setSelectedPathId(null)
        return
      }
      if (activeTool === 'pen') {
        if (e.detail === 2 && pathDraftPoints.current.length >= 2) {
          pushUndo()
          setActiveMap(s => ({
            ...s,
            paths: [...s.paths, {
              id: genId('p'),
              type: 'patrol',
              points: [...pathDraftPoints.current],
              properties: {}
            }]
          }))
          pathDraftPoints.current = []; clearPreview(); return
        }
        pathDraftPoints.current.push([wx, wy])
        return
      }
    }

    // ANNOTATIONS layer
    if (activeLayerType === 'annotations') {
      if (activeTool === 'comment_pin') {
        setShowCommentModal({ x: wx, y: wy })
        return
      }
      if (activeTool === 'move') {
        let hit: MapComment | null = null
        for (let i = activeMap.comments.length - 1; i >= 0; i--) {
          const c = activeMap.comments[i]
          if (Math.hypot(wx - c.x, wy - c.y) < 24) { hit = c; break }
        }
        if (hit) {
          setSelectedCommentId(hit.id)
          dragStart.current = [wx, wy]
          dragTarget.current = hit.id
          isDrawing.current = true
        }
        return
      }
    }
  }, [activeMap, activeLayerType, activeTool, panX, panY, screenToWorld, snapEnabled,
      zonePalette, activeZonePaletteId, activeTerrainType, activeObjectType, pushUndo, setActiveMap])

  const paintTerrainAt = useCallback((wx: number, wy: number) => {
    if (!activeMap) return
    const [col, row] = worldToCell(wx, wy, activeMap.settings)
    if (activeTool === 'eraser') {
      setActiveMap(s => ({ ...s, terrain: s.terrain.filter(c => !(c.col === col && c.row === row)) }))
    } else {
      setActiveMap(s => {
        const filtered = s.terrain.filter(c => !(c.col === col && c.row === row))
        return { ...s, terrain: [...filtered, { col, row, type: activeTerrainType }] }
      })
    }
  }, [activeMap, activeTerrainType, activeTool, setActiveMap])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!activeMap) return

    if (isPanning.current) {
      setPanX(panStart.current.px + (e.clientX - panStart.current.x))
      setPanY(panStart.current.py + (e.clientY - panStart.current.y))
      return
    }
    if (!isDrawing.current) return

    let [wx, wy] = screenToWorld(e.clientX, e.clientY)
    if (snapEnabled) [wx, wy] = snapToGrid(wx, wy, activeMap.settings)

    const previewCtx = previewCanvasRef.current?.getContext('2d')
    if (previewCtx) previewCtx.clearRect(0, 0, canvasW, canvasH)

    // Drag selected zone
    if (activeLayerType === 'zones' && activeTool === 'select' && dragTarget.current && dragStart.current) {
      const dx = wx - dragStart.current[0], dy = wy - dragStart.current[1]
      dragStart.current = [wx, wy]
      setActiveMap(s => ({
        ...s,
        zones: s.zones.map(z => z.id === dragTarget.current
          ? { ...z, points: z.points.map(([px, py]) => [px + dx, py + dy] as [number,number]) }
          : z)
      }))
      return
    }
    // Drag selected object
    if (activeLayerType === 'objects' && activeTool === 'select' && dragTarget.current && dragStart.current) {
      const dx = wx - dragStart.current[0], dy = wy - dragStart.current[1]
      dragStart.current = [wx, wy]
      setActiveMap(s => ({
        ...s,
        objects: s.objects.map(o => o.id === dragTarget.current
          ? { ...o, x: o.x + dx, y: o.y + dy }
          : o)
      }))
      return
    }
    // Drag selected path
    if (activeLayerType === 'paths' && activeTool === 'select' && dragTarget.current && dragStart.current) {
      const dx = wx - dragStart.current[0], dy = wy - dragStart.current[1]
      dragStart.current = [wx, wy]
      setActiveMap(s => ({
        ...s,
        paths: s.paths.map(p => p.id === dragTarget.current
          ? { ...p, points: p.points.map(([px, py]) => [px + dx, py + dy] as [number,number]) }
          : p)
      }))
      return
    }
    // Drag annotation
    if (activeLayerType === 'annotations' && activeTool === 'move' && dragTarget.current && dragStart.current) {
      const dx = wx - dragStart.current[0], dy = wy - dragStart.current[1]
      dragStart.current = [wx, wy]
      setActiveMap(s => ({
        ...s,
        comments: s.comments.map(c => c.id === dragTarget.current
          ? { ...c, x: c.x + dx, y: c.y + dy }
          : c)
      }))
      return
    }
    // Scatter brush spray
    if (activeLayerType === 'objects' && activeTool === 'scatter' && Math.random() < 0.15) {
      const newObj: MapObject = {
        id: genId('o'), type: activeObjectType,
        x: wx + (Math.random()-0.5)*40, y: wy + (Math.random()-0.5)*40,
        rotation: Math.random()*360, scale: 0.7+Math.random()*0.6, properties: {}
      }
      setActiveMap(s => ({ ...s, objects: [...s.objects, newObj] }))
      return
    }
    // Terrain painting
    if (activeLayerType === 'terrain' && (activeTool === 'brush' || activeTool === 'eraser')) {
      paintTerrainAt(wx, wy)
      return
    }
    // Rect / ellipse preview
    if ((activeTool === 'rect' || activeTool === 'ellipse') && dragStart.current && previewCtx) {
      const [sx, sy] = dragStart.current
      const activePalette = zonePalette.find(p => p.id === activeZonePaletteId)
      if (!activePalette) return
      const r = parseInt(activePalette.color.slice(1,3),16)
      const g = parseInt(activePalette.color.slice(3,5),16)
      const b = parseInt(activePalette.color.slice(5,7),16)
      previewCtx.fillStyle = `rgba(${r},${g},${b},0.25)`
      previewCtx.strokeStyle = `rgba(${r},${g},${b},0.9)`
      previewCtx.lineWidth = 1.5
      previewCtx.beginPath()
      if (activeTool === 'rect') {
        previewCtx.rect(sx, sy, wx-sx, wy-sy)
      } else {
        const cx = (sx+wx)/2, cy = (sy+wy)/2
        previewCtx.ellipse(cx, cy, Math.abs(wx-sx)/2, Math.abs(wy-sy)/2, 0, 0, Math.PI*2)
      }
      previewCtx.fill(); previewCtx.stroke()
      return
    }
    // Brush stroke freehand preview
    if (activeTool === 'brush' && activeLayerType === 'zones') {
      brushStroke.current.push([wx, wy])
      if (previewCtx && brushStroke.current.length > 1) {
        previewCtx.strokeStyle = zonePalette.find(p => p.id === activeZonePaletteId)?.color || '#fff'
        previewCtx.lineWidth = 2
        previewCtx.lineCap = 'round'
        previewCtx.lineJoin = 'round'
        previewCtx.beginPath()
        const pts = brushStroke.current
        previewCtx.moveTo(pts[0][0], pts[0][1])
        pts.forEach(([px,py]) => previewCtx.lineTo(px,py))
        previewCtx.stroke()
      }
      return
    }
    // Polygon preview line to cursor
    if (activeTool === 'polygon' && polygonPoints.current.length > 0 && previewCtx) {
      const last = polygonPoints.current[polygonPoints.current.length - 1]
      const activePalette = zonePalette.find(p => p.id === activeZonePaletteId)
      previewCtx.strokeStyle = activePalette?.color || '#ffffff'
      previewCtx.lineWidth = 1.5
      previewCtx.setLineDash([4,3])
      previewCtx.beginPath()
      // Draw existing polygon
      previewCtx.moveTo(polygonPoints.current[0][0], polygonPoints.current[0][1])
      polygonPoints.current.forEach(([px,py]) => previewCtx.lineTo(px,py))
      previewCtx.lineTo(wx, wy)
      previewCtx.stroke()
      previewCtx.setLineDash([])
      return
    }
    // Path pen preview
    if (activeTool === 'pen' && pathDraftPoints.current.length > 0 && previewCtx) {
      previewCtx.strokeStyle = 'rgba(205,241,43,0.8)'
      previewCtx.lineWidth = 2
      previewCtx.setLineDash([6,3])
      previewCtx.beginPath()
      previewCtx.moveTo(pathDraftPoints.current[0][0], pathDraftPoints.current[0][1])
      pathDraftPoints.current.forEach(([px,py]) => previewCtx.lineTo(px,py))
      previewCtx.lineTo(wx,wy)
      previewCtx.stroke()
      previewCtx.setLineDash([])
    }
  }, [activeMap, activeLayerType, activeTool, screenToWorld, snapEnabled, dragStart, zonePalette,
      activeZonePaletteId, activeObjectType, paintTerrainAt, canvasW, canvasH, setActiveMap, panX, panY])

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    if (isPanning.current) { isPanning.current = false; return }
    if (!isDrawing.current || !activeMap) { isDrawing.current = false; return }
    isDrawing.current = false

    let [wx, wy] = screenToWorld(e.clientX, e.clientY)
    if (snapEnabled) [wx, wy] = snapToGrid(wx, wy, activeMap.settings)

    const activePalette = zonePalette.find(p => p.id === activeZonePaletteId)

    if (activeLayerType === 'zones') {
      if (activeTool === 'rect' && dragStart.current && activePalette) {
        const [sx, sy] = dragStart.current
        if (Math.abs(wx-sx) < 4 && Math.abs(wy-sy) < 4) { clearPreview(); return }
        pushUndo()
        setActiveMap(s => ({
          ...s,
          zones: [...s.zones, {
            id: genId('z'), type: activePalette.type, name: activePalette.name,
            color: activePalette.color, shape: 'rect',
            points: [[sx,sy],[wx,sy],[wx,wy],[sx,wy]],
            properties: { ...activePalette.defaultProperties }
          }]
        }))
        clearPreview()
      }
      if (activeTool === 'ellipse' && dragStart.current && activePalette) {
        const [sx, sy] = dragStart.current
        if (Math.abs(wx-sx) < 4 && Math.abs(wy-sy) < 4) { clearPreview(); return }
        pushUndo()
        setActiveMap(s => ({
          ...s,
          zones: [...s.zones, {
            id: genId('z'), type: activePalette.type, name: activePalette.name,
            color: activePalette.color, shape: 'ellipse',
            points: [[sx,sy],[wx,wy]],
            properties: { ...activePalette.defaultProperties }
          }]
        }))
        clearPreview()
      }
      if (activeTool === 'brush' && brushStroke.current.length > 3 && activePalette) {
        pushUndo()
        const simplified = rdp(brushStroke.current, 6)
        setActiveMap(s => ({
          ...s,
          zones: [...s.zones, {
            id: genId('z'), type: activePalette.type, name: activePalette.name,
            color: activePalette.color, shape: 'polygon',
            points: simplified,
            properties: { ...activePalette.defaultProperties }
          }]
        }))
        brushStroke.current = []; clearPreview()
      }
      if (activeTool === 'select' && dragTarget.current) {
        // finalize move, already committed live, just push undo once
        dragTarget.current = null; dragStart.current = null
      }
    }

    if (activeLayerType === 'terrain') {
      if (activeTool === 'brush' || activeTool === 'eraser') {
        pushUndo()
      }
    }

    if (activeLayerType === 'objects') {
      if (activeTool === 'select' && dragTarget.current) {
        pushUndo()
        dragTarget.current = null; dragStart.current = null
      }
    }
    if (activeLayerType === 'paths') {
      if (activeTool === 'select' && dragTarget.current) {
        pushUndo()
        dragTarget.current = null; dragStart.current = null
      }
    }
    if (activeLayerType === 'annotations' && activeTool === 'move' && dragTarget.current) {
      pushUndo()
      dragTarget.current = null; dragStart.current = null
    }

    dragStart.current = null
  }, [activeMap, activeLayerType, activeTool, zonePalette, activeZonePaletteId, screenToWorld,
      snapEnabled, pushUndo, setActiveMap])

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.1 : 0.9
    setZoom(z => Math.max(0.1, Math.min(8, z * factor)))
  }, [])

  // New map wizard
  const createMap = () => {
    const settings: MapSettings = {
      mapId: genId('map'),
      name: wizardName,
      gridType: wizardGrid,
      cellSize: wizardCellSize,
      scaleLabel: wizardScale,
      width: wizardW,
      height: wizardH,
      locked: false,
    }
    const newMap = makeDefaultMap(settings)
    setMaps(prev => [...prev, newMap])
    setActiveMapIdx(maps.length)
    setShowNewMapWizard(false)
  }

  // Save checkpoint
  const saveCheckpoint = () => {
    if (!activeMap || !checkpointLabel.trim()) return
    setCheckpoints(prev => [...prev, {
      id: genId('cp'),
      label: checkpointLabel.trim(),
      timestamp: Date.now(),
      snapshot: serializeMap(activeMap)
    }])
    setCheckpointLabel('')
  }

  const restoreCheckpoint = (cp: Checkpoint) => {
    const restored = deserializeMap(cp.snapshot)
    if (restored) { pushUndo(); setActiveMap(() => restored) }
  }

  // Export
  const exportJSON = () => {
    if (!activeMap) return
    const json = serializeMap(activeMap)
    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${activeMap.settings.mapId}.json`
    a.click()
  }

  const exportPNG = () => {
    if (!activeMap) return
    const offscreen = document.createElement('canvas')
    offscreen.width = canvasW; offscreen.height = canvasH
    const ctx = offscreen.getContext('2d')!
    // Composite all visible layers in order
    const canvases = [bgCanvasRef, terrainCanvasRef, vectorCanvasRef]
    canvases.forEach(ref => { if (ref.current) ctx.drawImage(ref.current, 0, 0) })
    const a = document.createElement('a')
    a.href = offscreen.toDataURL('image/png')
    a.download = `${activeMap.settings.mapId}.png`
    a.click()
  }

  const loadJSON = () => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.json'
    input.onchange = (e: any) => {
      const file = e.target.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        const state = deserializeMap(ev.target?.result as string)
        if (state) {
          setMaps(prev => [...prev, state])
          setActiveMapIdx(maps.length)
        }
      }
      reader.readAsText(file)
    }
    input.click()
  }

  // Ensure valid tool when switching layers
  useEffect(() => {
    const validTools = LAYER_TOOLS[activeLayerType]
    if (validTools.length > 0 && !validTools.includes(activeTool)) {
      setActiveTool(validTools[0])
    }
  }, [activeLayerType])

  // Computed inspector data
  const selectedZone   = activeMap?.zones.find(z => z.id === selectedZoneId)
  const selectedObject = activeMap?.objects.find(o => o.id === selectedObjectId)
  const selectedPath   = activeMap?.paths.find(p => p.id === selectedPathId)
  const selectedComment= activeMap?.comments.find(c => c.id === selectedCommentId)

  // Tool labels
  const toolInfo: Record<ToolId, {label: string; icon: React.ReactNode}> = {
    select:      { label: 'Select', icon: <MousePointer size={13}/> },
    brush:       { label: 'Brush',  icon: <Pencil size={13}/> },
    rect:        { label: 'Rect',   icon: <Square size={13}/> },
    ellipse:     { label: 'Ellipse',icon: <Circle size={13}/> },
    polygon:     { label: 'Polygon',icon: <Triangle size={13}/> },
    bucket:      { label: 'Fill',   icon: <PaintBucket size={13}/> },
    eraser:      { label: 'Eraser', icon: <Eraser size={13}/> },
    eyedropper:  { label: 'Picker', icon: <Pipette size={13}/> },
    magic_wand:  { label: 'Wand',   icon: <Star size={13}/> },
    stamp:       { label: 'Stamp',  icon: <Package size={13}/> },
    scatter:     { label: 'Scatter',icon: <Crosshair size={13}/> },
    move:        { label: 'Move',   icon: <Move size={13}/> },
    delete_obj:  { label: 'Delete', icon: <Trash2 size={13}/> },
    pen:         { label: 'Pen',    icon: <GitFork size={13}/> },
    delete_node: { label: 'Del Node',icon: <Minus size={13}/> },
    comment_pin: { label: 'Pin',    icon: <MessageSquare size={13}/> },
  }

  // If no maps, show a landing screen
  if (maps.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 'var(--space-6)', color: 'var(--color-text-muted)' }}>
        <style>{`
          .mm-btn { background: var(--color-surface-2); border: 1px solid var(--color-surface-offset); color: var(--color-text-base); padding: 8px 16px; border-radius: var(--radius-md); font-size: var(--text-sm); cursor: pointer; display: flex; align-items: center; gap: 8px; transition: background 0.15s, border-color 0.15s; }
          .mm-btn:hover { background: var(--color-surface-offset); border-color: var(--color-primary); }
          .mm-btn.primary { background: var(--color-primary); border-color: var(--color-primary); color: #fff; }
          .mm-btn.primary:hover { background: var(--color-primary-hover); }
          .mm-btn.danger { background: rgba(239,68,68,0.15); border-color: rgba(239,68,68,0.4); color: #ef4444; }
          .mm-btn.danger:hover { background: rgba(239,68,68,0.25); }
          .mm-layer-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: var(--radius-md); cursor: pointer; transition: background 0.12s; }
          .mm-layer-row:hover { background: var(--color-surface-2); }
          .mm-layer-row.active { background: var(--color-primary-muted); border: 1px solid rgba(30,69,252,0.3); }
          .mm-tool-btn { background: transparent; border: 1px solid transparent; color: var(--color-text-muted); padding: 5px 8px; border-radius: var(--radius-sm); font-size: 11px; cursor: pointer; display: flex; align-items: center; gap: 5px; transition: all 0.12s; white-space: nowrap; }
          .mm-tool-btn:hover { background: var(--color-surface-2); color: var(--color-text-base); }
          .mm-tool-btn.active { background: var(--color-secondary-muted); border-color: rgba(205,241,43,0.4); color: var(--color-secondary); }
          .mm-panel { background: var(--color-surface-1); border: 1px solid var(--color-surface-offset); border-radius: var(--radius-lg); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }
          .mm-panel-title { font-size: 10px; font-weight: var(--weight-bold); text-transform: uppercase; letter-spacing: 0.07em; color: var(--color-text-faint); }
          .mm-input { background: var(--color-surface-2); border: 1px solid var(--color-surface-offset); color: var(--color-text-base); border-radius: var(--radius-sm); padding: 6px 10px; font-size: var(--text-xs); width: 100%; box-sizing: border-box; }
          .mm-input:focus { outline: none; border-color: var(--color-primary); }
          .mm-select { background: var(--color-surface-2); border: 1px solid var(--color-surface-offset); color: var(--color-text-base); border-radius: var(--radius-sm); padding: 6px 8px; font-size: var(--text-xs); cursor: pointer; width: 100%; }
          .mm-zone-row { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: var(--radius-sm); cursor: pointer; transition: background 0.12s; }
          .mm-zone-row:hover { background: var(--color-surface-2); }
          .mm-zone-row.active { background: var(--color-secondary-muted); outline: 1px solid rgba(205,241,43,0.3); }
          .mm-swatch { width: 14px; height: 14px; border-radius: 3px; flex-shrink: 0; }
          .mm-tag { font-size: 9px; padding: 1px 6px; border-radius: 999px; background: var(--color-surface-offset); color: var(--color-text-muted); }
          .mm-cp-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: var(--radius-sm); background: var(--color-surface-2); }
          .mm-canvas-area { position: relative; overflow: hidden; flex: 1; min-height: 0; background: #0b0c10; cursor: crosshair; }
          .mm-canvas-stack { position: absolute; transform-origin: top left; }
          .mm-canvas-stack canvas { position: absolute; top: 0; left: 0; }
          .mm-map-tab { background: var(--color-surface-2); border: 1px solid var(--color-surface-offset); color: var(--color-text-muted); padding: 4px 12px; border-radius: var(--radius-sm) var(--radius-sm) 0 0; font-size: 11px; cursor: pointer; transition: all 0.12s; }
          .mm-map-tab.active { background: var(--color-surface-1); color: var(--color-text-base); border-bottom-color: var(--color-surface-1); }
          .mm-separator { height: 1px; background: var(--color-surface-offset); margin: 4px 0; }
          .mm-kv-row { display: flex; gap: 4px; align-items: center; }
          .mm-kv-input { background: var(--color-surface-2); border: 1px solid var(--color-surface-offset); color: var(--color-text-base); border-radius: var(--radius-sm); padding: 4px 6px; font-size: 11px; flex: 1; }
          .mm-kv-input:focus { outline: none; border-color: var(--color-primary); }
        `}</style>
        <div style={{ textAlign: 'center' }}>
          <Map size={48} style={{ color: 'var(--color-primary)', marginBottom: 16 }} />
          <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)', margin: '0 0 8px' }}>Map Maker</h2>
          <p style={{ fontSize: 'var(--text-sm)', maxWidth: 400 }}>2D pre-production level design canvas. Paint zones, sketch layouts, and export structured JSON for Unity, Godot, or Unreal.</p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="mm-btn primary" onClick={() => setShowNewMapWizard(true)}><Plus size={14}/> New Map</button>
          <button className="mm-btn" onClick={loadJSON}><Upload size={14}/> Open JSON</button>
        </div>
        {showNewMapWizard && (
          <NewMapWizard
            name={wizardName} setName={setWizardName}
            grid={wizardGrid} setGrid={setWizardGrid}
            cellSize={wizardCellSize} setCellSize={setWizardCellSize}
            w={wizardW} setW={setWizardW}
            h={wizardH} setH={setWizardH}
            scale={wizardScale} setScale={setWizardScale}
            onCreate={createMap}
            onClose={() => setShowNewMapWizard(false)}
          />
        )}
      </div>
    )
  }

  // Main editor UI
  const validTools = LAYER_TOOLS[activeLayerType]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 0, overflow: 'hidden' }}>
      <style>{`
        .mm-btn { background: var(--color-surface-2); border: 1px solid var(--color-surface-offset); color: var(--color-text-base); padding: 6px 12px; border-radius: var(--radius-md); font-size: var(--text-xs); cursor: pointer; display: flex; align-items: center; gap: 6px; transition: background 0.15s, border-color 0.15s; flex-shrink: 0; }
        .mm-btn:hover { background: var(--color-surface-offset); border-color: var(--color-primary); }
        .mm-btn.primary { background: var(--color-primary); border-color: var(--color-primary); color: #fff; }
        .mm-btn.primary:hover { background: var(--color-primary-hover); }
        .mm-btn.danger { background: rgba(239,68,68,0.15); border-color: rgba(239,68,68,0.4); color: #ef4444; }
        .mm-btn.danger:hover { background: rgba(239,68,68,0.25); }
        .mm-layer-row { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: var(--radius-sm); cursor: pointer; transition: background 0.12s; }
        .mm-layer-row:hover { background: var(--color-surface-2); }
        .mm-layer-row.active { background: var(--color-primary-muted); border: 1px solid rgba(30,69,252,0.3); }
        .mm-tool-btn { background: transparent; border: 1px solid transparent; color: var(--color-text-muted); padding: 5px 8px; border-radius: var(--radius-sm); font-size: 11px; cursor: pointer; display: flex; align-items: center; gap: 5px; transition: all 0.12s; white-space: nowrap; }
        .mm-tool-btn:hover { background: var(--color-surface-2); color: var(--color-text-base); }
        .mm-tool-btn.active { background: var(--color-secondary-muted); border-color: rgba(205,241,43,0.4); color: var(--color-secondary); }
        .mm-panel { background: var(--color-surface-1); border: 1px solid var(--color-surface-offset); border-radius: var(--radius-lg); padding: var(--space-3); display: flex; flex-direction: column; gap: var(--space-2); }
        .mm-panel-title { font-size: 10px; font-weight: var(--weight-bold); text-transform: uppercase; letter-spacing: 0.07em; color: var(--color-text-faint); }
        .mm-input { background: var(--color-surface-2); border: 1px solid var(--color-surface-offset); color: var(--color-text-base); border-radius: var(--radius-sm); padding: 5px 8px; font-size: var(--text-xs); width: 100%; box-sizing: border-box; }
        .mm-input:focus { outline: none; border-color: var(--color-primary); }
        .mm-select { background: var(--color-surface-2); border: 1px solid var(--color-surface-offset); color: var(--color-text-base); border-radius: var(--radius-sm); padding: 5px 8px; font-size: var(--text-xs); cursor: pointer; width: 100%; }
        .mm-zone-row { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: var(--radius-sm); cursor: pointer; transition: background 0.12s; user-select: none; }
        .mm-zone-row:hover { background: var(--color-surface-2); }
        .mm-zone-row.active { background: var(--color-secondary-muted); outline: 1px solid rgba(205,241,43,0.3); }
        .mm-swatch { width: 14px; height: 14px; border-radius: 3px; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.15); }
        .mm-tag { font-size: 9px; padding: 1px 5px; border-radius: 999px; background: var(--color-surface-offset); color: var(--color-text-muted); }
        .mm-cp-row { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border-radius: var(--radius-sm); background: var(--color-surface-2); }
        .mm-canvas-area { position: relative; overflow: hidden; flex: 1; min-height: 0; background: repeating-conic-gradient(#1b1f30 0% 25%, #131622 0% 50%) 0 0 / 16px 16px; cursor: crosshair; user-select: none; }
        .mm-canvas-stack { position: absolute; transform-origin: top left; }
        .mm-canvas-stack canvas { position: absolute; top: 0; left: 0; }
        .mm-map-tab { background: transparent; border: 1px solid transparent; color: var(--color-text-muted); padding: 4px 12px; border-radius: var(--radius-sm) var(--radius-sm) 0 0; font-size: 11px; cursor: pointer; transition: all 0.12s; }
        .mm-map-tab.active { background: var(--color-surface-1); color: var(--color-text-base); border-color: var(--color-surface-offset); border-bottom-color: var(--color-surface-1); }
        .mm-separator { height: 1px; background: var(--color-surface-offset); margin: 2px 0; }
        .mm-kv-row { display: flex; gap: 4px; align-items: center; }
        .mm-kv-input { background: var(--color-surface-2); border: 1px solid var(--color-surface-offset); color: var(--color-text-base); border-radius: var(--radius-sm); padding: 3px 6px; font-size: 11px; flex: 1; min-width: 0; }
        .mm-kv-input:focus { outline: none; border-color: var(--color-primary); }
        .mm-obj-type-btn { background: var(--color-surface-2); border: 1px solid var(--color-surface-offset); border-radius: var(--radius-sm); padding: 5px 8px; cursor: pointer; font-size: 11px; display: flex; flex-direction: column; align-items: center; gap: 2px; color: var(--color-text-muted); transition: all 0.12s; }
        .mm-obj-type-btn:hover { background: var(--color-surface-offset); color: var(--color-text-base); }
        .mm-obj-type-btn.active { background: var(--color-secondary-muted); border-color: rgba(205,241,43,0.4); color: var(--color-secondary); }
        .mm-terrain-btn { background: var(--color-surface-2); border: 2px solid transparent; border-radius: var(--radius-sm); padding: 4px 8px; cursor: pointer; font-size: 11px; display: flex; align-items: center; gap: 5px; color: var(--color-text-muted); transition: all 0.12s; }
        .mm-terrain-btn.active { border-color: var(--color-secondary); color: var(--color-text-base); }
      `}</style>

      {/* Top control bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'var(--color-surface-1)', borderBottom: '1px solid var(--color-surface-offset)', flexShrink: 0, flexWrap: 'wrap' }}>
        {/* Zoom controls */}
        <button className="mm-btn" onClick={() => setZoom(z => Math.min(8, z * 1.2))} title="Zoom In"><ZoomIn size={13}/></button>
        <button className="mm-btn" onClick={() => setZoom(z => Math.max(0.1, z / 1.2))} title="Zoom Out"><ZoomOut size={13}/></button>
        <button className="mm-btn" onClick={() => { setZoom(1); setPanX(24); setPanY(24) }} title="Reset View"><Maximize size={13}/></button>
        <span style={{ fontSize: 10, color: 'var(--color-text-faint)', minWidth: 36, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>

        <div style={{ width: 1, height: 20, background: 'var(--color-surface-offset)' }} />

        {/* Grid info */}
        {activeMap && (
          <>
            <span style={{ fontSize: 10, color: 'var(--color-text-faint)' }}>
              {activeMap.settings.gridType.toUpperCase()} · {activeMap.settings.cellSize}px · {activeMap.settings.scaleLabel}
            </span>
            <button
              className={`mm-btn ${snapEnabled ? 'primary' : ''}`}
              onClick={() => setSnapEnabled(s => !s)}
              title="Snap to Grid"
            >
              <Crosshair size={12}/> Snap
            </button>
          </>
        )}

        <div style={{ width: 1, height: 20, background: 'var(--color-surface-offset)' }} />

        {/* Undo/Redo */}
        <button className="mm-btn" onClick={undo} title="Undo (Ctrl+Z)"><RotateCcw size={13}/></button>
        <button className="mm-btn" onClick={redo} title="Redo (Ctrl+Y)"><RotateCw size={13}/></button>

        <div style={{ flex: 1 }} />

        {/* File ops */}
        <button className="mm-btn" onClick={loadJSON} title="Open JSON"><Upload size={13}/> Open</button>
        <button className="mm-btn" onClick={exportJSON} title="Export JSON"><FileJson size={13}/> JSON</button>
        <button className="mm-btn" onClick={exportPNG} title="Export PNG"><Image size={13}/> PNG</button>
        <button className="mm-btn" onClick={() => setShowUnityModal(true)} title="Get Unity Importer"><Code size={13}/> Unity</button>
        <button className="mm-btn primary" onClick={() => setShowNewMapWizard(true)}><Plus size={13}/> New Map</button>
      </div>

      {/* Map page tabs */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, padding: '0 12px', background: 'var(--color-surface-1)', borderBottom: '1px solid var(--color-surface-offset)', flexShrink: 0 }}>
        {maps.map((m, i) => (
          <button
            key={m.settings.mapId}
            className={`mm-map-tab ${i === activeMapIdx ? 'active' : ''}`}
            onClick={() => setActiveMapIdx(i)}
          >
            {m.settings.name}
          </button>
        ))}
      </div>

      {/* Three-column editor body */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

        {/* Left: Tool panel */}
        <div style={{ width: 180, flexShrink: 0, background: 'var(--color-surface-1)', borderRight: '1px solid var(--color-surface-offset)', display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 8px', overflowY: 'auto' }}>
          {/* Layer selector */}
          <div className="mm-panel">
            <div className="mm-panel-title">Active Layer</div>
            {(['terrain','zones','objects','paths','annotations'] as LayerType[]).map(lt => (
              <button
                key={lt}
                className={`mm-layer-row ${activeLayerType === lt ? 'active' : ''}`}
                onClick={() => setActiveLayerType(lt)}
                style={{ width: '100%', border: 'none', background: 'none', textAlign: 'left', cursor: 'pointer', fontSize: 12, color: activeLayerType === lt ? 'var(--color-text-base)' : 'var(--color-text-muted)' }}
              >
                <span style={{ textTransform: 'capitalize' }}>{lt}</span>
              </button>
            ))}
          </div>

          {/* Tools */}
          <div className="mm-panel">
            <div className="mm-panel-title">Tools</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {validTools.map(tid => (
                <button
                  key={tid}
                  className={`mm-tool-btn ${activeTool === tid ? 'active' : ''}`}
                  onClick={() => setActiveTool(tid)}
                  title={toolInfo[tid].label}
                >
                  {toolInfo[tid].icon}
                  <span>{toolInfo[tid].label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Zone palette */}
          {activeLayerType === 'zones' && (
            <div className="mm-panel" style={{ flex: 1 }}>
              <div className="mm-panel-title">Zone Palette</div>
              {zonePalette.map(zp => (
                <div
                  key={zp.id}
                  className={`mm-zone-row ${zp.id === activeZonePaletteId ? 'active' : ''}`}
                  onClick={() => setActiveZonePaletteId(zp.id)}
                >
                  <div className="mm-swatch" style={{ background: zp.color }} />
                  <span style={{ fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-text-base)' }}>{zp.name}</span>
                </div>
              ))}
              <button className="mm-btn" style={{ width: '100%', justifyContent: 'center', marginTop: 4, fontSize: 11 }}
                onClick={() => {
                  const newEntry: ZonePaletteEntry = { id: genId('zp'), type: 'custom', name: 'New Zone', color: '#8338EC', defaultProperties: {} }
                  setZonePalette(prev => [...prev, newEntry])
                  setActiveZonePaletteId(newEntry.id)
                }}>
                <Plus size={11}/> Add Zone
              </button>
            </div>
          )}

          {/* Terrain types */}
          {activeLayerType === 'terrain' && (
            <div className="mm-panel" style={{ flex: 1 }}>
              <div className="mm-panel-title">Terrain Type</div>
              {TERRAIN_TYPES.map(t => (
                <button
                  key={t}
                  className={`mm-terrain-btn ${activeTerrainType === t ? 'active' : ''}`}
                  onClick={() => setActiveTerrainType(t)}
                >
                  <div style={{ width: 12, height: 12, borderRadius: 2, background: TERRAIN_COLORS[t], flexShrink: 0 }} />
                  {t}
                </button>
              ))}
            </div>
          )}

          {/* Object types */}
          {activeLayerType === 'objects' && (
            <div className="mm-panel" style={{ flex: 1 }}>
              <div className="mm-panel-title">Object Type</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                {OBJECT_TYPES.map(ot => (
                  <button
                    key={ot.id}
                    className={`mm-obj-type-btn ${activeObjectType === ot.id ? 'active' : ''}`}
                    onClick={() => setActiveObjectType(ot.id)}
                  >
                    <span style={{ fontSize: 16 }}>{ot.icon}</span>
                    <span style={{ fontSize: 9 }}>{ot.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Center: Canvas */}
        <div
          className="mm-canvas-area"
          ref={containerRef}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onWheel={onWheel}
          style={{ cursor: activeTool === 'comment_pin' ? 'cell' : activeTool === 'select' ? 'default' : activeTool === 'eraser' ? 'crosshair' : 'crosshair' }}
        >
          <div
            className="mm-canvas-stack"
            style={{ transform: `translate(${panX}px, ${panY}px) scale(${zoom})`, width: canvasW, height: canvasH }}
          >
            {/* Map border */}
            <div style={{ position: 'absolute', inset: 0, boxShadow: '0 0 0 1px rgba(255,255,255,0.08)', pointerEvents: 'none', zIndex: 100 }} />

            <canvas ref={bgCanvasRef}     width={canvasW} height={canvasH} style={{ zIndex: 1 }} />
            <canvas ref={terrainCanvasRef}width={canvasW} height={canvasH} style={{ zIndex: 2 }} />
            <canvas ref={vectorCanvasRef} width={canvasW} height={canvasH} style={{ zIndex: 3 }} />
            <canvas ref={previewCanvasRef}width={canvasW} height={canvasH} style={{ zIndex: 4, pointerEvents: 'none' }} />
            <canvas ref={gridCanvasRef}   width={canvasW} height={canvasH} style={{ zIndex: 5, pointerEvents: 'none', opacity: 0.6 }} />
          </div>

          {/* Polygon hint */}
          {activeTool === 'polygon' && activeLayerType === 'zones' && (
            <div style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', background: 'rgba(13,16,34,0.9)', border: '1px solid var(--color-surface-offset)', borderRadius: 999, padding: '4px 12px', fontSize: 11, color: 'var(--color-text-muted)', pointerEvents: 'none' }}>
              Click to add vertices · Double-click to close polygon · Esc to cancel
            </div>
          )}
          {activeTool === 'pen' && activeLayerType === 'paths' && (
            <div style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', background: 'rgba(13,16,34,0.9)', border: '1px solid var(--color-surface-offset)', borderRadius: 999, padding: '4px 12px', fontSize: 11, color: 'var(--color-text-muted)', pointerEvents: 'none' }}>
              Click to add waypoints · Double-click to finish path · Esc to cancel
            </div>
          )}
        </div>

        {/* Right: Layers + Inspector */}
        <div style={{ width: 220, flexShrink: 0, background: 'var(--color-surface-1)', borderLeft: '1px solid var(--color-surface-offset)', display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 8px', overflowY: 'auto' }}>

          {/* Layers stack */}
          <div className="mm-panel">
            <div className="mm-panel-title">Layers</div>
            {activeMap?.layers.slice().reverse().map(layer => (
              <div key={layer.id} className="mm-layer-row" style={{ border: '1px solid transparent' }}>
                <button
                  onClick={() => setActiveMap(s => ({ ...s, layers: s.layers.map(l => l.id === layer.id ? { ...l, visible: !l.visible } : l) }))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: layer.visible ? 'var(--color-secondary)' : 'var(--color-text-faint)', padding: 0, display: 'flex' }}
                  title={layer.visible ? 'Hide' : 'Show'}
                >
                  {layer.visible ? <Eye size={12}/> : <EyeOff size={12}/>}
                </button>
                <button
                  onClick={() => setActiveMap(s => ({ ...s, layers: s.layers.map(l => l.id === layer.id ? { ...l, locked: !l.locked } : l) }))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: layer.locked ? 'var(--color-warning)' : 'var(--color-text-faint)', padding: 0, display: 'flex' }}
                  title={layer.locked ? 'Unlock' : 'Lock'}
                >
                  {layer.locked ? <Lock size={11}/> : <Unlock size={11}/>}
                </button>
                <span style={{ flex: 1, fontSize: 11, color: 'var(--color-text-base)', textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {layer.name}
                </span>
                <input
                  type="range" min={0} max={1} step={0.05}
                  value={layer.opacity}
                  onChange={e => setActiveMap(s => ({ ...s, layers: s.layers.map(l => l.id === layer.id ? { ...l, opacity: Number(e.target.value) } : l) }))}
                  style={{ width: 48, cursor: 'pointer', accentColor: 'var(--color-primary)' }}
                  title={`Opacity: ${Math.round(layer.opacity * 100)}%`}
                />
              </div>
            ))}
          </div>

          {/* Inspector */}
          <div className="mm-panel" style={{ flex: 1 }}>
            <div className="mm-panel-title">Inspector</div>
            {selectedZone && (
              <ZoneInspector
                key={inspectorKey + selectedZone.id}
                zone={selectedZone}
                onChange={z => setActiveMap(s => ({ ...s, zones: s.zones.map(zz => zz.id === z.id ? z : zz) }))}
                onDelete={() => deleteZone(selectedZone.id)}
                zonePalette={zonePalette}
              />
            )}
            {selectedObject && !selectedZone && (
              <ObjectInspector
                key={inspectorKey + selectedObject.id}
                obj={selectedObject}
                onChange={o => setActiveMap(s => ({ ...s, objects: s.objects.map(oo => oo.id === o.id ? o : oo) }))}
                onDelete={() => deleteObject(selectedObject.id)}
              />
            )}
            {selectedPath && !selectedZone && !selectedObject && (
              <PathInspector
                key={inspectorKey + selectedPath.id}
                path={selectedPath}
                onChange={p => setActiveMap(s => ({ ...s, paths: s.paths.map(pp => pp.id === p.id ? p : pp) }))}
                onDelete={() => deletePath(selectedPath.id)}
              />
            )}
            {selectedComment && !selectedZone && !selectedObject && !selectedPath && (
              <CommentInspector
                key={inspectorKey + selectedComment.id}
                comment={selectedComment}
                onChange={c => setActiveMap(s => ({ ...s, comments: s.comments.map(cc => cc.id === c.id ? c : cc) }))}
                onDelete={() => deleteComment(selectedComment.id)}
              />
            )}
            {!selectedZone && !selectedObject && !selectedPath && !selectedComment && (
              <div style={{ color: 'var(--color-text-faint)', fontSize: 11, textAlign: 'center', padding: '12px 0' }}>
                Select an element to inspect
              </div>
            )}
          </div>

          {/* Version checkpoints */}
          <div className="mm-panel">
            <div className="mm-panel-title">Checkpoints</div>
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                className="mm-input"
                placeholder="Label…"
                value={checkpointLabel}
                onChange={e => setCheckpointLabel(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveCheckpoint()}
                style={{ flex: 1 }}
              />
              <button className="mm-btn primary" onClick={saveCheckpoint} title="Save Checkpoint" style={{ padding: '5px 8px' }}>
                <Check size={12}/>
              </button>
            </div>
            {checkpoints.slice().reverse().map(cp => (
              <div key={cp.id} className="mm-cp-row">
                <span style={{ flex: 1, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-text-base)' }}>{cp.label}</span>
                <span style={{ fontSize: 9, color: 'var(--color-text-faint)' }}>{new Date(cp.timestamp).toLocaleTimeString()}</span>
                <button
                  onClick={() => restoreCheckpoint(cp)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', padding: 0, display: 'flex' }}
                  title="Restore"
                >
                  <RefreshCw size={11}/>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Modals */}
      {showNewMapWizard && (
        <NewMapWizard
          name={wizardName} setName={setWizardName}
          grid={wizardGrid} setGrid={setWizardGrid}
          cellSize={wizardCellSize} setCellSize={setWizardCellSize}
          w={wizardW} setW={setWizardW}
          h={wizardH} setH={setWizardH}
          scale={wizardScale} setScale={setWizardScale}
          onCreate={createMap}
          onClose={() => setShowNewMapWizard(false)}
        />
      )}

      {showCommentModal && (
        <Modal title="Add Comment" onClose={() => setShowCommentModal(null)}>
          <textarea
            className="mm-input"
            rows={3}
            placeholder="Design note…"
            value={commentDraft}
            onChange={e => setCommentDraft(e.target.value)}
            style={{ resize: 'vertical' }}
            autoFocus
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="mm-btn" onClick={() => { setShowCommentModal(null); setCommentDraft('') }}>Cancel</button>
            <button className="mm-btn primary" onClick={() => {
              if (!showCommentModal || !commentDraft.trim()) return
              pushUndo()
              setActiveMap(s => ({
                ...s,
                comments: [...s.comments, { id: genId('c'), text: commentDraft.trim(), x: showCommentModal.x, y: showCommentModal.y }]
              }))
              setCommentDraft('')
              setShowCommentModal(null)
            }}>Pin Note</button>
          </div>
        </Modal>
      )}

      {showUnityModal && (
        <Modal title="Unity Import Script" onClose={() => setShowUnityModal(false)} wide>
          <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8 }}>
            Copy this C# script into your Unity project's <code>Assets/</code> folder. Open it from <strong>Window → Map Maker → Import Map JSON</strong>.
          </p>
          <pre style={{
            background: 'var(--color-surface-2)', borderRadius: 'var(--radius-md)',
            padding: 12, fontSize: 10, overflowX: 'auto', maxHeight: 360,
            color: 'var(--color-text-muted)', lineHeight: 1.5,
            border: '1px solid var(--color-surface-offset)'
          }}>
            {generateUnityScript()}
          </pre>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="mm-btn primary" onClick={() => navigator.clipboard.writeText(generateUnityScript())}>
              <Copy size={12}/> Copy to Clipboard
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// Sub-components

function Modal({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: 'var(--color-surface-1)', border: '1px solid var(--color-surface-offset)',
        borderRadius: 'var(--radius-lg)', padding: 20,
        width: wide ? 720 : 400, maxWidth: '90vw', maxHeight: '80vh', overflow: 'auto',
        display: 'flex', flexDirection: 'column', gap: 12
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 'var(--text-base)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-base)' }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-faint)', padding: 4 }}><X size={16}/></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function NewMapWizard({ name, setName, grid, setGrid, cellSize, setCellSize, w, setW, h, setH, scale, setScale, onCreate, onClose }:
  { name:string; setName:(v:string)=>void; grid:GridType; setGrid:(v:GridType)=>void; cellSize:number; setCellSize:(v:number)=>void; w:number; setW:(v:number)=>void; h:number; setH:(v:number)=>void; scale:string; setScale:(v:string)=>void; onCreate:()=>void; onClose:()=>void }) {
  return (
    <Modal title="New Map" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <FieldRow label="Map Name">
          <input className="mm-input" value={name} onChange={e => setName(e.target.value)} placeholder="Untitled Map" />
        </FieldRow>
        <FieldRow label="Grid Type">
          <select className="mm-select" value={grid} onChange={e => setGrid(e.target.value as GridType)}>
            <option value="square">Square</option>
            <option value="hex">Hex (Flat-top, Axial)</option>
            <option value="isometric">Isometric</option>
          </select>
        </FieldRow>
        <FieldRow label={grid === 'hex' ? 'Hex Radius (px)' : 'Cell Size (px)'}>
          <input className="mm-input" type="number" min={8} max={256} value={cellSize} onChange={e => setCellSize(Number(e.target.value))} />
        </FieldRow>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <FieldRow label="Width (px)">
            <input className="mm-input" type="number" min={400} max={8192} value={w} onChange={e => setW(Number(e.target.value))} />
          </FieldRow>
          <FieldRow label="Height (px)">
            <input className="mm-input" type="number" min={400} max={8192} value={h} onChange={e => setH(Number(e.target.value))} />
          </FieldRow>
        </div>
        <FieldRow label="Scale Label">
          <input className="mm-input" value={scale} onChange={e => setScale(e.target.value)} placeholder="1 cell = 1m" />
        </FieldRow>
        <div style={{ padding: '8px 10px', background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.2)', borderRadius: 'var(--radius-md)', fontSize: 11, color: 'var(--color-warning)', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>Grid type and canvas dimensions are locked after creation to prevent coordinate misalignment.</span>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="mm-btn" onClick={onClose}>Cancel</button>
          <button className="mm-btn primary" onClick={onCreate}><Plus size={13}/> Create Map</button>
        </div>
      </div>
    </Modal>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{label}</label>
      {children}
    </div>
  )
}

function KVEditor({ properties, onChange }: { properties: Record<string,string>; onChange: (p: Record<string,string>) => void }) {
  const entries = Object.entries(properties)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {entries.map(([k, v]) => (
        <div key={k} className="mm-kv-row">
          <input className="mm-kv-input" value={k} onChange={e => {
            const next = { ...properties }
            delete next[k]; next[e.target.value] = v; onChange(next)
          }} placeholder="key" />
          <span style={{ color: 'var(--color-text-faint)', fontSize: 11 }}>:</span>
          <input className="mm-kv-input" value={v} onChange={e => onChange({ ...properties, [k]: e.target.value })} placeholder="value" />
          <button onClick={() => { const next = { ...properties }; delete next[k]; onChange(next) }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)', padding: 2, display: 'flex', flexShrink: 0 }}>
            <X size={10}/>
          </button>
        </div>
      ))}
      <button className="mm-btn" style={{ fontSize: 10, padding: '3px 8px' }}
        onClick={() => onChange({ ...properties, [`key_${Date.now()}`]: '' })}>
        <Plus size={10}/> Add Property
      </button>
    </div>
  )
}

function ZoneInspector({ zone, onChange, onDelete, zonePalette }:
  { zone: ZoneDef; onChange: (z: ZoneDef) => void; onDelete: () => void; zonePalette: ZonePaletteEntry[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <FieldRow label="Name">
        <input className="mm-input" value={zone.name} onChange={e => onChange({ ...zone, name: e.target.value })} />
      </FieldRow>
      <FieldRow label="Type">
        <select className="mm-select" value={zone.type} onChange={e => {
          const match = zonePalette.find(p => p.type === e.target.value)
          onChange({ ...zone, type: e.target.value, color: match?.color || zone.color })
        }}>
          {zonePalette.map(p => <option key={p.id} value={p.type}>{p.name}</option>)}
        </select>
      </FieldRow>
      <FieldRow label="Color">
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <div className="mm-swatch" style={{ background: zone.color, width: 20, height: 20 }} />
          <input className="mm-input" value={zone.color} onChange={e => onChange({ ...zone, color: e.target.value })} style={{ flex: 1 }} />
        </div>
      </FieldRow>
      <div style={{ fontSize: 10, color: 'var(--color-text-faint)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Properties</div>
      <KVEditor properties={zone.properties} onChange={p => onChange({ ...zone, properties: p })} />
      <button className="mm-btn danger" style={{ justifyContent: 'center', marginTop: 4 }} onClick={onDelete}>
        <Trash2 size={11}/> Delete Zone
      </button>
    </div>
  )
}

function ObjectInspector({ obj, onChange, onDelete }:
  { obj: MapObject; onChange: (o: MapObject) => void; onDelete: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <FieldRow label="Type">
        <select className="mm-select" value={obj.type} onChange={e => onChange({ ...obj, type: e.target.value })}>
          {OBJECT_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </FieldRow>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <FieldRow label="X">
          <input className="mm-input" type="number" value={Math.round(obj.x)} onChange={e => onChange({ ...obj, x: Number(e.target.value) })} />
        </FieldRow>
        <FieldRow label="Y">
          <input className="mm-input" type="number" value={Math.round(obj.y)} onChange={e => onChange({ ...obj, y: Number(e.target.value) })} />
        </FieldRow>
        <FieldRow label="Rotation °">
          <input className="mm-input" type="number" min={0} max={359} value={Math.round(obj.rotation)} onChange={e => onChange({ ...obj, rotation: Number(e.target.value) })} />
        </FieldRow>
        <FieldRow label="Scale">
          <input className="mm-input" type="number" min={0.1} max={10} step={0.1} value={obj.scale.toFixed(2)} onChange={e => onChange({ ...obj, scale: Number(e.target.value) })} />
        </FieldRow>
      </div>
      <div style={{ fontSize: 10, color: 'var(--color-text-faint)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Properties</div>
      <KVEditor properties={obj.properties} onChange={p => onChange({ ...obj, properties: p })} />
      <button className="mm-btn danger" style={{ justifyContent: 'center', marginTop: 4 }} onClick={onDelete}>
        <Trash2 size={11}/> Delete Object
      </button>
    </div>
  )
}

function PathInspector({ path, onChange, onDelete }:
  { path: MapPath; onChange: (p: MapPath) => void; onDelete: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <FieldRow label="Type">
        <select className="mm-select" value={path.type} onChange={e => onChange({ ...path, type: e.target.value })}>
          {['patrol','road','river','border','camera_rail','custom'].map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </FieldRow>
      <div style={{ fontSize: 10, color: 'var(--color-text-faint)' }}>{path.points.length} waypoints</div>
      <div style={{ fontSize: 10, color: 'var(--color-text-faint)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Properties</div>
      <KVEditor properties={path.properties} onChange={p => onChange({ ...path, properties: p })} />
      <button className="mm-btn danger" style={{ justifyContent: 'center', marginTop: 4 }} onClick={onDelete}>
        <Trash2 size={11}/> Delete Path
      </button>
    </div>
  )
}

function CommentInspector({ comment, onChange, onDelete }:
  { comment: MapComment; onChange: (c: MapComment) => void; onDelete: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <FieldRow label="Note">
        <textarea className="mm-input" rows={3} value={comment.text} onChange={e => onChange({ ...comment, text: e.target.value })} style={{ resize: 'vertical' }} />
      </FieldRow>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <FieldRow label="X"><input className="mm-input" type="number" value={Math.round(comment.x)} onChange={e => onChange({ ...comment, x: Number(e.target.value) })} /></FieldRow>
        <FieldRow label="Y"><input className="mm-input" type="number" value={Math.round(comment.y)} onChange={e => onChange({ ...comment, y: Number(e.target.value) })} /></FieldRow>
      </div>
      <button className="mm-btn danger" style={{ justifyContent: 'center', marginTop: 4 }} onClick={onDelete}>
        <Trash2 size={11}/> Delete Note
      </button>
    </div>
  )
}
