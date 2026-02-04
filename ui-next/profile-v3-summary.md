# Profile Page v3 - Design Summary

## 🎯 Key Improvements in v3

### 1. **Scalability: Handles ~20+ Pools**

**Problem:** Original design showed all pools inline, which doesn't scale beyond 5-10 items.

**Solution:**
- **Scrollable container** with `max-height: 400px` and smooth overflow
- **Search/filter** at the top to quickly find pools among 22+ items
- **Real-time filtering** that shows "No pools match" when search is empty
- Maintains visual stability during search (container size doesn't jump)

**Benefits:**
- ✅ Works with 2 pools or 200 pools
- ✅ Fast keyboard-driven workflow (type to filter)
- ✅ No pagination needed - scroll is natural for settings
- ✅ Search is instant (client-side filtering)

---

### 2. **Consistent Stage+Commit Pattern**

**Decision:** Use **stage+commit with Save buttons** across ALL sections.

**Why this pattern?**

Based on analysis of the app:
1. **Settings pages typically batch changes** - Users expect to make multiple edits, then commit all at once
2. **Provides safety** - Users can review changes before saving
3. **Clear feedback** - Visual indicators show unsaved changes
4. **Matches form conventions** - Standard pattern for configuration pages

**Implementation:**

| Section | Pattern | Save Trigger |
|---------|---------|--------------|
| **Notifications** | Stage+Commit | "Save Changes" button |
| **Default Bucket** | Stage+Commit | "Save Changes" button |
| **Pools** | Stage+Commit | "Save Default" button |
| **Credentials** | **Immediate** | Actions save instantly |

**Why credentials are different:**
- CRUD operations (create/delete) are atomic actions
- Users don't typically batch credential changes
- Immediate feedback is expected for security-critical operations
- Matches GitHub, AWS, and other credential management UIs

**Visual Feedback:**
```css
/* Card shows NVIDIA green border when it has unsaved changes */
.card.has-changes {
  border-color: var(--nvidia-green);
  box-shadow: 0 0 0 1px var(--nvidia-green);
}
```

**Button States:**
- **Initial state:** Save and Reset buttons are **disabled**
- **After change:** Buttons **enable**, card gets green border
- **After save:** Buttons **disable**, border resets, toast appears

---

### 3. **Toast Notifications (Sonner Pattern)**

**App Convention:** Uses Sonner (sonner.tsx) for toast notifications

**Implementation in v3:**
- Custom toast container in bottom-right corner
- Two types: **success** (green accent) and **error** (red accent)
- Auto-dismiss after 5 seconds
- Smooth slide-in animation from right
- Stacks multiple toasts vertically
- Non-blocking (doesn't require user interaction)

**Toast Usage:**

| Action | Toast Message |
|--------|---------------|
| Save notifications | ✅ "Notifications updated" |
| Save bucket | ✅ "Default bucket updated" |
| Save pool | ✅ "Default pool updated" + pool name |
| Delete credential | ✅ "Credential deleted" + credential name |
| Create credential | ✅ "Credential created" |
| API error | ❌ "Failed to save" + error details |

**Design Details:**
- Uses NVIDIA green left border for success
- Shows icon + title + optional description
- Matches app's card styling (background, border, shadow)
- Supports both light and dark mode

---

## 🎨 Design Patterns

### Pool List Design

**Layout:**
```
┌─────────────────────────────────────────┐
│ [🔍 Search pools...]                    │
├─────────────────────────────────────────┤
│ ╭───────────────────────────────────╮   │
│ │ ○  my-pool         [DEFAULT]      │   │
│ │    8 GPUs • A100                  │   │
│ ├───────────────────────────────────┤   │
│ │ ○  team-pool                      │   │ ← Scrollable
│ │    16 GPUs • H100                 │   │   (max 400px)
│ │ ├───────────────────────────────┤ │   │
│ │ ○  gpu-pool                       │   │
│ │    4 GPUs • V100                  │   │
│ ╰───────────────────────────────────╯   │
└─────────────────────────────────────────┘
```

**Interaction:**
1. User searches: "hpc" → filters to "hpc-cluster"
2. User clicks different pool → selected state updates + card shows green border
3. User clicks "Save Default" → API call → toast → border clears

**Visual States:**
- **Default pool:** Green left border (3px), "Default" badge, green radio dot
- **Hover:** Gray background
- **Selected (new):** Green background, green border, green radio dot, "Default" badge

### Card Footer Pattern

Every card with changes shows:
```
┌────────────────────────────────────────────┐
│                          [Reset] [Save...] │
└────────────────────────────────────────────┘
```

- **Reset:** Discards changes, reloads initial state
- **Save:** Commits changes, shows toast, disables buttons
- Both buttons **disabled** by default
- Both buttons **enable** when changes are detected

---

## 📊 State Management

### Card State Tracking

```javascript
const cardStates = {
  notificationCard: { hasChanges: false, initialState: {} },
  bucketCard: { hasChanges: false, initialState: {} },
  poolCard: { hasChanges: false, initialState: {} }
};
```

**Flow:**
1. User interacts → `markCardChanged(cardId)` called
2. Card gets `.has-changes` class → green border appears
3. Buttons enable
4. User clicks Save → API call → `resetCard(cardId)`
5. Green border clears, buttons disable, toast shows

### Pool Selection State

```javascript
let selectedPool = 'my-pool';      // Current selection
const initialPool = 'my-pool';     // Original value from API

// Compare to detect changes
if (selectedPool !== initialPool) {
  markCardChanged('poolCard');
}
```

---

## 🔄 Data Flow

### On Page Load (React Implementation)

```typescript
// 1. Fetch profile data
const { data: profile } = useProfile();

// 2. Initialize state
const [emailNotifications, setEmailNotifications] = useState(profile.notifications.email);
const [slackNotifications, setSlackNotifications] = useState(profile.notifications.slack);
const [defaultBucket, setDefaultBucket] = useState(profile.bucket.default);
const [defaultPool, setDefaultPool] = useState(profile.pool.default);

// 3. Track changes
const [hasNotificationChanges, setHasNotificationChanges] = useState(false);
const [hasBucketChanges, setHasBucketChanges] = useState(false);
const [hasPoolChanges, setHasPoolChanges] = useState(false);
```

### On Save

```typescript
const saveNotifications = async () => {
  try {
    await updateProfile({
      notifications: {
        email: emailNotifications,
        slack: slackNotifications
      }
    });

    // Show success toast
    toast.success('Notifications updated', {
      description: 'Your notification preferences have been saved'
    });

    // Reset change tracking
    setHasNotificationChanges(false);

  } catch (error) {
    // Show error toast
    toast.error('Failed to save', {
      description: error.message
    });
  }
};
```

---

## 🎯 UX Considerations

### Why Stage+Commit?

**Pros:**
- ✅ **Safety:** Users review before committing
- ✅ **Clarity:** Visual feedback shows what's changed
- ✅ **Flexibility:** Make multiple changes before saving
- ✅ **Standard:** Matches user expectations for settings pages
- ✅ **Error recovery:** Can reset changes without reload

**Cons:**
- ⚠️ Extra click required (but expected for settings)
- ⚠️ Need to track state (but React handles this well)

**Alternative considered: Auto-save**
- Would save on every change (switch toggle, dropdown selection)
- **Rejected because:**
  - No way to review changes before commit
  - Harder to batch related changes
  - Can't easily undo mistakes
  - Creates API spam (multiple requests for related changes)
  - Surprising for settings (users expect to confirm)

### Why Immediate Save for Credentials?

Credentials are **different from settings** because:
- Users create/delete credentials as **discrete actions**
- Security-critical operations need immediate confirmation
- Users don't typically "batch" credential operations
- Standard pattern (AWS, GitHub, Azure all use immediate save)

---

## 🚀 React Implementation Notes

### Components to Create

```
ProfilePage
├── UserInfoCard (read-only)
├── NotificationsCard
│   ├── SwitchRow (email)
│   ├── SwitchRow (slack)
│   └── CardFooter (save/reset)
├── DefaultBucketCard
│   ├── BucketSelect
│   └── CardFooter (save/reset)
├── PoolsCard
│   ├── SearchInput
│   ├── PoolList (virtualized if >50 items)
│   │   └── PoolItem (radio-style)
│   └── CardFooter (save/reset)
└── CredentialsCard
    ├── CredentialSection (registry/data/generic)
    │   └── CredentialItem (edit/delete)
    └── CreateCredentialModal
```

### Hooks

```typescript
// API hooks
const { profile, isLoading } = useProfile();
const { mutate: updateProfile } = useUpdateProfile();
const { credentials } = useCredentials();
const { mutate: deleteCredential } = useDeleteCredential();

// Form state
const { hasChanges, reset, save } = useProfileForm(profile);

// Pool search
const { filteredPools, searchQuery, setSearchQuery } = usePoolSearch(profile.pools);
```

### Toast Integration

```typescript
import { toast } from 'sonner';

// Success
toast.success('Pool updated', {
  description: `Default pool changed to ${poolName}`
});

// Error
toast.error('Failed to save', {
  description: error.message
});
```

---

## 📈 Performance Considerations

### Pool List Optimization

**Current:** 22 pools, ~400px container = renders all
**Scaling:** If >50 pools, consider:
- TanStack Virtual for virtualization
- Lazy render items outside viewport
- Keep search bar and selected item always visible

**Search Performance:**
- Client-side filtering (instant)
- Debounced if >100 pools
- Case-insensitive matching on name + metadata

### State Updates

- Card change detection is O(1) - simple boolean flag
- Pool filtering is O(n) but n is small (22-100 max)
- No unnecessary re-renders (buttons disabled when no changes)

---

## ✅ Accessibility

### Keyboard Navigation

- **Tab:** Navigate between form elements
- **Enter/Space:** Toggle switches, activate buttons
- **Arrow keys:** Navigate dropdown options
- **Escape:** Close modal
- **Type to search:** Works in pool search input

### Screen Reader Support

```html
<button aria-label="Delete credential my-ngc-cred">...</button>
<label class="switch">
  <input type="checkbox" aria-label="Email notifications" />
  ...
</label>
```

### Focus Management

- Modal traps focus when open
- Focus returns to trigger button on close
- All interactive elements have visible focus rings
- Save buttons show disabled state clearly

---

## 📦 Files Created

- **profile-prototype.html** - Original design (v1)
- **profile-prototype-v2.html** - Combined pools approach (v2)
- **profile-prototype-v3.html** - Scalable + consistent save pattern ✅
- **profile-design-comparison.md** - v1 vs v2 analysis
- **profile-v3-summary.md** - This document

---

## 🎯 Next Steps for Implementation

1. **Create React components** following the structure above
2. **Add API hooks** using TanStack Query
3. **Implement toast notifications** using existing Sonner setup
4. **Add virtualization** if pool count > 50 (TanStack Virtual)
5. **Test keyboard navigation** and screen reader support
6. **Add loading states** for async operations
7. **Handle API errors** gracefully with error toasts
8. **Add optimistic updates** for better perceived performance
