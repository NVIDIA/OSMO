# Profile Page v4 - No Modals (Except Destructive Actions)

## 🎯 Major Changes from v3

### ❌ Removed: Modal for Creating/Editing Credentials
### ✅ Added: Inline/Collapsible Editing

---

## 🆕 New Patterns in v4

### 1. **Collapsible "New Credential" Form**

**Before (v3):** Floating action button → Opens modal

**After (v4):** Dashed border button → Expands inline form

```
┌─────────────────────────────────────────┐
│ [+ New Credential]  ← Collapsed state   │
└─────────────────────────────────────────┘

                  ↓ Click

┌─────────────────────────────────────────┐
│ Create New Credential                   │
├─────────────────────────────────────────┤
│ Credential Name: [____________]         │
│ Type: [Select type ▼]                  │
│ [Dynamic fields based on type]          │
│                                         │
│                    [Cancel] [Create]    │
└─────────────────────────────────────────┘
```

**UX Benefits:**
- ✅ No navigation away from page
- ✅ Context remains visible (can see existing credentials)
- ✅ Feels lighter than modal
- ✅ Vertically stacks with credential list
- ✅ Less visual interruption

**Interaction:**
1. User clicks "+ New Credential" button
2. Button fades out, form expands below it with slide-down animation
3. User fills form
4. Click "Create" → Form collapses, new credential appears in list, toast confirms
5. Click "Cancel" → Form collapses back to button

---

### 2. **Expandable Credential Items (Accordion-style)**

**Before (v3):** Click Edit → Opens modal with form

**After (v4):** Click credential row OR edit icon → Row expands inline with form

```
┌─────────────────────────────────────────┐
│ my-ngc-cred            [🖊️] [🗑️]        │
│ REGISTRY • nvcr.io • 2 days ago         │
└─────────────────────────────────────────┘
                  ↓ Click anywhere on row or edit icon
┌─────────────────────────────────────────┐
│ my-ngc-cred            [🖊️] [🗑️]        │  ← Header remains
│ REGISTRY • nvcr.io • 2 days ago         │
├─────────────────────────────────────────┤
│ Registry URL: [nvcr.io_____________]    │  ← Form fields
│ Username: [$oauthtoken____________]     │
│ Password: [••••••••_______________]     │
│                                         │
│                    [Cancel] [Save...]   │
└─────────────────────────────────────────┘
```

**UX Benefits:**
- ✅ Editing feels lightweight (no modal overlay)
- ✅ Context preserved (can see other credentials above/below)
- ✅ Natural spatial relationship (form is "inside" the item)
- ✅ One item editable at a time (others auto-collapse)
- ✅ Familiar accordion pattern

**Visual States:**
- **Collapsed:** Gray background, clickable row, hover effect
- **Expanded:** White background, green border, header not clickable
- **Form:** Slides down with smooth animation

**Interaction:**
1. User clicks credential row (anywhere)
2. Row expands downward with form fields
3. Other expanded credentials auto-collapse
4. User edits fields
5. Click "Save" → Row collapses, toast confirms
6. Click "Cancel" → Row collapses, changes discarded

---

### 3. **Confirmation Dialog (Only for Destructive Actions)**

**What gets a modal:**
- ✅ Delete credential (destructive, needs confirmation)

**What doesn't get a modal:**
- ❌ Create credential (use collapsible form)
- ❌ Edit credential (use inline expansion)

**Dialog Design:**
```
┌──────────────────────────────────────┐
│ Delete Credential?                   │
├──────────────────────────────────────┤
│ Are you sure you want to delete      │
│ my-ngc-cred? This action cannot be   │
│ undone.                              │
│                                      │
│                  [Cancel] [Delete]   │
└──────────────────────────────────────┘
```

**Why keep modal for delete?**
- ✅ Destructive action needs strong confirmation
- ✅ Focus user's attention on the decision
- ✅ Industry standard (AWS, GitHub, etc.)
- ✅ Prevents accidental deletion

---

## 📊 Comparison: Modal vs Inline/Collapsible

| Aspect | Modal (v3) | Inline/Collapsible (v4) |
|--------|------------|-------------------------|
| **Context** | ❌ Loses context (overlay) | ✅ Keeps context visible |
| **Navigation** | ❌ Feels like leaving page | ✅ Feels like expanding section |
| **Interruption** | ⚠️ Strong interruption | ✅ Gentle expansion |
| **Multi-tasking** | ❌ Can't see other items | ✅ Can reference other credentials |
| **Mobile** | ⚠️ Takes full screen | ✅ Scrollable, natural |
| **Complexity** | ⚠️ Requires overlay management | ✅ Simple show/hide |
| **Escape behavior** | ⚠️ What happens to changes? | ✅ Clear cancel button |

---

## 🎨 Visual Design Details

### New Credential Button (Collapsed State)

```css
.new-credential-trigger {
  border: 1px dashed var(--border);  /* Dashed = expandable */
  background: var(--muted);
  color: var(--foreground);

  /* Hover indicates interactivity */
  &:hover {
    border-color: var(--nvidia-green);
    background: lighter variant;
  }
}
```

**Visual cues:**
- Dashed border = "this is different from regular items"
- Plus icon = "add new"
- Full width = "this belongs here in the flow"
- Muted background = "not yet active"

### Expanded Form State

```css
.new-credential-form.active {
  border: 1px solid var(--nvidia-green);  /* Solid green = active/editing */
  background: var(--background);
  animation: slideDown 200ms ease-out;
}
```

**Visual cues:**
- Solid green border = "you're now in creation mode"
- White/primary background = "elevated content"
- Slide-down animation = "expanding from button"

### Credential Item States

```css
/* Collapsed - Ready to click */
.credential-item {
  background: var(--muted);
  cursor: pointer;

  &:hover {
    background: slightly darker;
  }
}

/* Expanded - Now editing */
.credential-item.editing {
  border-color: var(--nvidia-green);
  background: var(--background);

  .credential-header {
    cursor: default;  /* Header no longer clickable */
    border-bottom: 1px solid var(--border);
  }
}
```

**Visual cues:**
- Gray background = "collapsed, data display"
- Hover = "click to edit"
- Green border + white background = "expanded, editing mode"
- Header border = "form is below"

---

## 🎯 Interaction Patterns

### Creating a Credential

**v3 (Modal):**
1. Click "New Credential" → Modal opens, overlay appears
2. Fill form in modal (can't see page)
3. Click "Create" → Modal closes, returns to page
4. Toast confirms

**v4 (Collapsible):**
1. Click "+ New Credential" → Form expands inline
2. Fill form (page still visible, can scroll)
3. Click "Create" → Form collapses, credential appears
4. Toast confirms

**Why v4 is better:**
- No context switch (no overlay)
- Can reference existing credentials while creating
- Feels more integrated with the page
- Mobile-friendly (no full-screen takeover)

### Editing a Credential

**v3 (Modal):**
1. Click "Edit" icon → Modal opens
2. Edit fields in modal
3. Click "Save" → Modal closes
4. Toast confirms

**v4 (Expandable):**
1. Click credential row → Row expands inline
2. Edit fields in place
3. Click "Save" → Row collapses
4. Toast confirms

**Why v4 is better:**
- Spatial relationship clear (editing THIS item)
- Other credentials visible (can compare values)
- Natural accordion behavior (familiar pattern)
- Less disorienting than modal pop-in

### Deleting a Credential

**Both v3 and v4:**
1. Click "Delete" icon → Confirmation dialog opens
2. Confirm in modal
3. Item removed, toast confirms

**Why modal is kept:**
- Destructive action needs strong confirmation
- Focus attention on critical decision
- Standard pattern for delete confirmation
- Modal appropriate for "Are you sure?" moments

---

## 🔄 State Management

### Tracking Expanded Credentials

```javascript
let currentEditingCredential = null;

function toggleCredentialEdit(credId) {
  // Close all other expanded credentials
  document.querySelectorAll('.credential-item.editing').forEach(item => {
    if (item.id !== credId) {
      item.classList.remove('editing');
    }
  });

  // Toggle clicked credential
  const item = document.getElementById(credId);
  item.classList.toggle('editing');

  // Track current
  currentEditingCredential = item.classList.contains('editing') ? credId : null;
}
```

**Rules:**
- Only one credential can be expanded at a time
- Clicking another credential auto-collapses the current one
- Provides clear focus and reduces visual complexity

### New Credential Form State

```javascript
function toggleNewCredentialForm() {
  // Hide button, show form
  trigger.classList.add('active');  // Hides button
  form.classList.add('active');     // Shows form
}

function cancelNewCredential() {
  // Show button, hide form
  trigger.classList.remove('active');
  form.classList.remove('active');
}
```

**Rules:**
- Button and form are mutually exclusive (one visible at a time)
- Cancel returns to button state
- Create saves and returns to button state

---

## 🎬 Animation Details

### Slide Down Animation

```css
@keyframes slideDown {
  from {
    opacity: 0;
    max-height: 0;
  }
  to {
    opacity: 1;
    max-height: 500px;  /* Enough for form fields */
  }
}
```

**Applied to:**
- New credential form expansion
- Credential item editing expansion

**Duration:** 200ms (fast enough to feel responsive, slow enough to be smooth)

**Why this works:**
- Communicates the spatial relationship (expanding FROM button/row)
- Feels lightweight and responsive
- Matches accordion pattern expectations

---

## 🚀 React Implementation

### Components Structure

```tsx
<CredentialSection type="registry">
  {/* Collapsible New Credential Form */}
  <NewCredentialForm
    expanded={isCreating}
    onToggle={() => setIsCreating(!isCreating)}
    onCreate={handleCreate}
    onCancel={() => setIsCreating(false)}
  />

  {/* Expandable Credential List */}
  <CredentialList>
    {credentials.map(cred => (
      <CredentialItem
        key={cred.id}
        credential={cred}
        expanded={editingId === cred.id}
        onToggle={() => toggleEdit(cred.id)}
        onSave={handleSave}
        onDelete={() => showDeleteConfirm(cred.name)}
      />
    ))}
  </CredentialList>
</CredentialSection>

{/* Delete Confirmation Dialog (only modal) */}
<ConfirmDialog
  open={deleteDialogOpen}
  title="Delete Credential?"
  description={`Are you sure you want to delete ${credToDelete}?`}
  onConfirm={handleDelete}
  onCancel={closeDeleteDialog}
/>
```

### State Management

```typescript
// Track which credential is being edited (only one at a time)
const [editingId, setEditingId] = useState<string | null>(null);

// Track new credential form state
const [isCreating, setIsCreating] = useState(false);

// Delete confirmation
const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
const [credToDelete, setCredToDelete] = useState<string | null>(null);

// Toggle edit (auto-closes others)
const toggleEdit = (id: string) => {
  setEditingId(editingId === id ? null : id);
};
```

---

## 📋 Decision Framework: When to Use Each Pattern

### Use **Collapsible Inline Form** when:
- ✅ Creating new items in a list
- ✅ User benefits from seeing context (other list items)
- ✅ Form is moderately complex (3-8 fields)
- ✅ Action is additive, not disruptive

**Examples:**
- Creating credentials
- Adding tags
- Creating filters
- Adding team members

### Use **Expandable Rows** when:
- ✅ Editing existing items in a list
- ✅ Natural spatial relationship (edit THIS item)
- ✅ Users might want to compare with nearby items
- ✅ Familiar accordion pattern applies

**Examples:**
- Editing credentials
- Editing tags
- Editing configuration items
- Updating list entries

### Use **Modal/Dialog** when:
- ✅ Destructive action needs confirmation
- ✅ Critical decision requires focus
- ✅ Breaking context is intentional (force attention)
- ✅ Complex multi-step flow

**Examples:**
- Delete confirmations
- Critical warnings
- Multi-step wizards
- Full-screen editing (very complex forms)

---

## ✅ Benefits of v4 Approach

### For Users:
- ✅ **Less disorienting** - No modal pop-overs
- ✅ **More context** - Can see other credentials while editing
- ✅ **Familiar pattern** - Accordion-style expansion is well-understood
- ✅ **Lightweight** - Feels like adjusting settings, not "opening a form"
- ✅ **Mobile-friendly** - Scrollable, no viewport takeover

### For Developers:
- ✅ **Simpler state** - No modal open/close state
- ✅ **Easier testing** - No overlay/focus trap complexity
- ✅ **Better a11y** - Natural tab order, no focus management needed
- ✅ **Less code** - No modal component, overlay, backdrop
- ✅ **Responsive by default** - Works naturally on all screen sizes

### For Performance:
- ✅ **Lighter DOM** - No modal overlay rendered
- ✅ **Fewer animations** - Simple slide-down vs modal entrance/exit
- ✅ **No z-index wars** - Everything in natural stacking context

---

## 🎯 Summary

**v4 eliminates modals for CRUD operations in favor of:**
1. **Collapsible inline form** for creating credentials
2. **Expandable rows** for editing credentials
3. **Confirmation dialog only** for destructive actions (delete)

**Result:** A lighter, more integrated experience that keeps users in context while providing all the same functionality.
