# Profile Page Design Comparison

## Pool Management: Two Approaches

Since pools are **authorization-based and static** (users cannot add/remove them), here are two design approaches:

---

## Approach 1: Separate Cards (Original)

**Layout:** Two side-by-side cards
- **Left:** "Default Pool" card with dropdown selector
- **Right:** "Available Pools" card with chip list + Add/Remove buttons

### ❌ Problems with this approach:

1. **Misleading UI** - The "Add Pool" button and remove buttons on chips suggest users can modify their pool access, but they can't (it's authorization-based)

2. **Redundant information** - The dropdown and chip list show the same pools twice

3. **Unclear relationship** - It's not immediately obvious that the dropdown is selecting from the chip list

4. **More clicks** - Users must:
   - Open dropdown
   - Select pool
   - Click "Save Changes"

### ✅ When this might work:
- If pools were user-configurable (not the case here)
- If there was a distinction between "accessible" and "subscribed" pools

---

## Approach 2: Combined Card (v2 - RECOMMENDED)

**Layout:** Single card titled "Pools" with radio-style selection list

### ✅ Advantages:

1. **Truthful interface** - No misleading add/remove buttons. The list represents what you have access to (read-only authorization)

2. **Single source of truth** - All pools in one list with the default clearly marked

3. **Clearer interaction model** - Click to select default, badge shows current selection

4. **Better visual hierarchy**:
   ```
   Pool Name           [Radio] [Default Badge]
   GPU info/metadata
   ```

5. **Efficient workflow** - One click to change default (radio selection), then "Save Default" button to confirm

6. **Better use of space** - Fits more metadata per pool (GPU types, availability counts)

7. **Semantic HTML** - Radio button pattern communicates "choose one" behavior

### 🎯 Key Design Elements (v2):

- **Radio-style selection** - Visual radio button (not actual radio input for better styling control)
- **"Default" badge** - Prominent NVIDIA green badge on selected pool
- **Rich metadata** - Each pool shows GPU count and type
- **Single save action** - "Save Default" button at bottom
- **Authorization context** - Subtitle explains: "Available pools are determined by your access permissions"

### 📊 Layout Structure:

```
┌─────────────────────────────────────────────┐
│ 🖥️  Pools           [3 accessible]          │
├─────────────────────────────────────────────┤
│ Select your default pool. Available pools   │
│ are determined by your access permissions.  │
│                                             │
│ ┌─────────────────────────────────────┐    │
│ │ ○  my-pool          [DEFAULT]       │    │
│ │    8 GPUs available • A100          │    │
│ └─────────────────────────────────────┘    │
│                                             │
│ ┌─────────────────────────────────────┐    │
│ │ ○  team-pool                        │    │
│ │    16 GPUs available • H100         │    │
│ └─────────────────────────────────────┘    │
│                                             │
│ ┌─────────────────────────────────────┐    │
│ │ ○  gpu-pool                         │    │
│ │    4 GPUs available • V100          │    │
│ └─────────────────────────────────────┘    │
│                                             │
│                    [Cancel] [Save Default]  │
└─────────────────────────────────────────────┘
```

---

## Comparison Table

| Aspect | Approach 1 (Separate) | Approach 2 (Combined) ✅ |
|--------|----------------------|-------------------------|
| **Truth in UI** | ❌ Misleading (suggests add/remove) | ✅ Honest (read-only list) |
| **Information Density** | ❌ Same info shown twice | ✅ Single source of truth |
| **Interaction Model** | ❌ Dropdown (hides options) | ✅ Radio list (all visible) |
| **Metadata Display** | ⚠️ Limited space | ✅ Rich per-pool metadata |
| **Clicks to Change** | 3 clicks (open, select, save) | 2 clicks (select, save) |
| **Semantic Clarity** | ⚠️ Two separate concerns | ✅ Clear "choose default" pattern |
| **Space Efficiency** | ⚠️ Takes 2 card slots | ✅ Takes 1 card slot |
| **Future Expandability** | ⚠️ Hard to add pool details | ✅ Easy to add more metadata |

---

## Recommendation

**Use Approach 2 (Combined Card)** because:

1. ✅ **Accurate mental model** - Users see all accessible pools and select one as default
2. ✅ **Better UX** - Radio selection is more direct than dropdown
3. ✅ **Richer information** - Can show GPU types, availability, metadata inline
4. ✅ **Honest interface** - No fake add/remove actions
5. ✅ **Matches authorization reality** - Pool access is permission-based, not user-configurable

---

## Implementation Notes (React)

### Data Structure:
```typescript
interface Pool {
  name: string;
  gpuCount: number;
  gpuType: string; // "A100", "H100", etc.
  isDefault: boolean;
}

// API returns all accessible pools
const { pools } = usePools();
const defaultPool = pools.find(p => p.isDefault);
```

### Component Hierarchy:
```tsx
<PoolsCard>
  <CardHeader>
    <Title>Pools</Title>
    <Badge>{pools.length} accessible</Badge>
  </CardHeader>

  <Subtitle>
    Select your default pool. Available pools are determined by your access permissions.
  </Subtitle>

  <PoolList>
    {pools.map(pool => (
      <PoolItem
        key={pool.name}
        pool={pool}
        isSelected={pool.isDefault}
        onSelect={handleSelect}
      />
    ))}
  </PoolList>

  <CardFooter>
    <Button variant="secondary">Cancel</Button>
    <Button variant="primary">Save Default</Button>
  </CardFooter>
</PoolsCard>
```

### State Management:
```typescript
const [selectedPool, setSelectedPool] = useState(defaultPool);
const [hasChanges, setHasChanges] = useState(false);

const handleSelect = (pool: Pool) => {
  setSelectedPool(pool);
  setHasChanges(pool.name !== defaultPool.name);
};

const handleSave = async () => {
  await updateDefaultPool(selectedPool.name);
  // Refresh profile data
};
```

---

## Files

- **profile-prototype.html** - Original design (separate cards)
- **profile-prototype-v2.html** - Recommended design (combined card) ✅
- **profile-design-comparison.md** - This document
