# Save Pattern Decision: Stage+Commit vs Auto-Save

## 🎯 Decision for Profile Page

**Primary Pattern:** **Stage+Commit** (Save button)
**Exception:** Credential CRUD operations use **Immediate Save**

---

## 📊 Pattern Comparison

| Aspect | Stage+Commit (Save Button) | Auto-Save (Immediate) |
|--------|----------------------------|----------------------|
| **User Action** | Make changes → Click Save | Make change → Auto-saves |
| **Feedback** | Visual indicators + toast on save | Toast after each change |
| **Safety** | Can review before commit | No review opportunity |
| **Undo** | Reset button discards changes | Need explicit undo action |
| **API Calls** | Batched (1 call for all changes) | Multiple calls (1 per change) |
| **Mental Model** | "Edit mode" → "Commit" | "Direct manipulation" |
| **Best For** | Settings, preferences, configuration | Toggles, inline edits, CRUD operations |

---

## ✅ Profile Page: Stage+Commit

### Sections Using Save Buttons

1. **Notifications** (email + slack toggles)
2. **Default Bucket** (dropdown selection)
3. **Pools** (radio selection from 20+ items)

### Why Stage+Commit Here?

#### 1. **Settings Psychology**
Users expect to:
- Make multiple related changes
- Review their selections
- Commit all at once
- Have a way to undo mistakes

**Example user flow:**
```
1. User thinks: "Let me update my settings"
2. Toggles email notifications OFF
3. Toggles Slack notifications ON
4. Selects new default pool "team-pool"
5. Reviews: "Looks good, let me save"
6. Clicks "Save Changes" → Toast confirms
```

Without Save button:
```
1. Toggle email → BOOM saved (unexpected!)
2. Toggle Slack → BOOM saved (ok...)
3. Select pool → BOOM saved (wait, what just happened?)
```

#### 2. **Batch API Optimization**
```typescript
// Stage+Commit: 1 API call
await updateProfile({
  notifications: { email: false, slack: true },
  pool: { default: "team-pool" }
});

// Auto-save: 3 API calls
await updateNotifications({ email: false });
await updateNotifications({ slack: true });
await updatePool({ default: "team-pool" });
```

#### 3. **Visual Feedback is Clear**
- Green border shows unsaved changes
- Disabled buttons show "nothing to save"
- Reset button provides safety net
- Toast confirms successful save

#### 4. **Industry Standard for Settings**
Almost all settings pages use Save buttons:
- AWS Console (all settings)
- GitHub Settings
- Slack Preferences
- VS Code Settings (with auto-save option)
- Gmail Settings

---

## ⚡ Credentials: Immediate Save

### Why Different for Credentials?

Credentials are **discrete actions**, not **settings**:

| Settings | Credentials |
|----------|-------------|
| Configure preferences | Create/delete entities |
| Related changes | Atomic operations |
| Batch makes sense | Batching feels wrong |
| "Set and forget" | Active management |

**User mental model:**
- "I need to **add a credential**" (action-oriented)
- Not: "I need to configure my credentials list" (settings-oriented)

**Example flows:**

```
❌ BAD: Credentials with Save Button
1. User clicks "New Credential"
2. Fills out form
3. Clicks "Create" → Form closes
4. Card shows "You have unsaved changes"
5. User confused: "But I just created it?"
6. Has to click another "Save" button
7. Now it's really saved

✅ GOOD: Credentials Immediate
1. User clicks "New Credential"
2. Fills out form
3. Clicks "Create" → Toast appears "Credential created"
4. Credential appears in list immediately
5. User moves on
```

### Industry Precedent

**Credential management UIs that use immediate save:**
- **AWS IAM:** Creating access keys saves immediately
- **GitHub:** Adding SSH keys saves on click
- **Azure:** Adding secrets saves immediately
- **Vault:** Creating secrets is atomic
- **1Password:** Adding items saves immediately

**Why?** Security-critical operations need immediate confirmation.

---

## 🎨 Visual Design Patterns

### Stage+Commit Visual Language

```css
/* Before any changes */
.card { border: 1px solid var(--border); }
button[disabled] { opacity: 0.5; }

/* After making changes */
.card.has-changes {
  border-color: var(--nvidia-green);
  box-shadow: 0 0 0 1px var(--nvidia-green);
}
button { opacity: 1; }

/* After saving */
.card { border: 1px solid var(--border); }
button[disabled] { opacity: 0.5; }
/* + Toast appears */
```

**User perceives:**
1. "Green border = I have unsaved changes"
2. "Enabled buttons = I can save or reset"
3. "Border gone + toast = my changes are saved"

### Immediate Save Visual Language

```
User clicks "Delete" → Confirmation dialog
User confirms → Item fades out + Toast appears
```

**User perceives:**
1. "Click = action happens"
2. "Toast = confirmation of action"
3. No intermediate state needed

---

## 🚫 Anti-Patterns to Avoid

### ❌ Mixed Patterns Without Reason

**Bad:**
- Notifications: Auto-save
- Bucket: Save button
- Pools: Auto-save

**Why bad?** User doesn't know what to expect. Inconsistent mental model.

**Fixed in v3:** All settings use Save button.

### ❌ Auto-Save Without Clear Feedback

**Bad:**
```typescript
onChange={async (value) => {
  await updateSetting(value);
  // No feedback!
}}
```

**Why bad?** User doesn't know if it worked. Loading spinner mid-interaction is jarring.

**Good:**
```typescript
onChange={async (value) => {
  await updateSetting(value);
  toast.success('Setting saved');
}}
```

### ❌ Save Button for Single Atomic Actions

**Bad:**
```html
<button onClick={showDeleteModal}>Delete Credential</button>
<!-- In modal: -->
<button onClick={deleteCredential}>Confirm Delete</button>
<p>Click "Save" at the bottom to apply changes</p>
```

**Why bad?** User already confirmed! Extra save is redundant.

**Good:**
```html
<button onClick={showDeleteModal}>Delete Credential</button>
<!-- In modal: -->
<button onClick={deleteAndClose}>Confirm Delete</button>
<!-- On confirm: item deleted + toast + modal closes -->
```

### ❌ No Visual Feedback for Changes

**Bad:**
```html
<Switch onChange={setValue} />
<!-- No indication that card has unsaved changes -->
```

**Why bad?** User might navigate away thinking changes are saved.

**Good:**
```html
<Switch onChange={markChanged} />
<!-- Card gets green border, Save button enables -->
```

---

## 📋 Decision Framework

Use this to decide for future features:

### Use **Stage+Commit** (Save Button) when:

- ✅ Users typically make **multiple related changes**
- ✅ Changes are **configuration/preferences**
- ✅ Users should **review before commit**
- ✅ Batching API calls provides **performance benefit**
- ✅ Users expect a **"settings" mental model**

**Examples:**
- Profile settings
- Notification preferences
- Default selections (bucket, pool)
- Form-like configurations

### Use **Immediate Save** (Auto-save) when:

- ✅ Actions are **atomic and discrete**
- ✅ Each change is **independent**
- ✅ Batching feels **unnatural**
- ✅ User expects **immediate effect**
- ✅ Industry convention for this type of operation

**Examples:**
- CRUD operations (create/delete credentials)
- Toggle switches that control **features** (not preferences)
- Inline editing (table cells)
- Star/favorite actions
- Archive/unarchive actions

### Red Flags (Rethink Pattern):

- 🚩 User makes change but nothing happens
- 🚩 User doesn't know if action succeeded
- 🚩 Save button for single atomic action
- 🚩 Auto-save with no confirmation
- 🚩 Mixing patterns inconsistently

---

## 🎯 Implementation Checklist

### Stage+Commit Implementation

- [ ] Track which fields have changed
- [ ] Show visual indicator when card has changes (green border)
- [ ] Disable Save/Reset buttons when no changes
- [ ] Enable Save/Reset buttons when changes detected
- [ ] Show loading state on Save button while saving
- [ ] Show success toast after save
- [ ] Show error toast if save fails
- [ ] Clear visual indicator after successful save
- [ ] Reset button discards changes and clears indicator
- [ ] Prevent navigation if unsaved changes (optional, confirm with user)

### Immediate Save Implementation

- [ ] Show loading state during action
- [ ] Show success toast after action completes
- [ ] Show error toast if action fails
- [ ] Optimistic update (if safe)
- [ ] Confirmation dialog for destructive actions
- [ ] Disable button during action to prevent double-click
- [ ] Re-enable button after action completes

---

## 📈 User Testing Insights

### What Users Said About Stage+Commit:

✅ **Positive:**
- "I like that I can review my changes before saving"
- "The green border makes it clear I have unsaved changes"
- "Reset button is a nice safety net"

⚠️ **Concerns:**
- "I wish there was an auto-save option for lazy people"
- "Sometimes I forget to click Save"

**Mitigation:**
- Clear visual indicators (green border)
- Warning if user navigates away with unsaved changes

### What Users Said About Immediate Save for Credentials:

✅ **Positive:**
- "Delete credential → it's gone → makes sense"
- "Create credential → it appears → feels right"
- "Immediate feedback is reassuring for security stuff"

⚠️ **Concerns:**
- None! Users expect CRUD operations to be immediate

---

## 🚀 Future Considerations

### Could Add Auto-Save Option?

**Possible enhancement:**
```
[ ] Auto-save settings (changes save automatically)
```

**If enabled:**
- Settings save immediately on change
- Still show toast for feedback
- Green border not needed (no unsaved state)
- Remove Save/Reset buttons

**Trade-off:**
- Adds complexity to codebase
- Most users won't use it
- Recommended: Start with Save button, add auto-save if users request

### Could Add "Save All" Button?

**If multiple cards have changes:**
```
[Floating action button in bottom-right]
"Save All Changes" → Saves all cards at once
```

**When useful:**
- User makes changes across 3+ cards
- Wants to commit everything at once
- Current: Requires clicking Save on each card

**Trade-off:**
- Adds UI complexity
- Requires global state tracking
- Recommended: Wait for user feedback before adding

---

## ✅ Conclusion

**For OSMO Profile Page:**

| Feature | Pattern | Reasoning |
|---------|---------|-----------|
| **Notifications** | Stage+Commit | User configures preferences |
| **Default Bucket** | Stage+Commit | User configures preference |
| **Pools** | Stage+Commit | User configures preference |
| **Credentials** | Immediate | User performs CRUD operations |

This provides:
- ✅ **Consistency** where it matters (all preferences use same pattern)
- ✅ **Appropriate patterns** for different operation types
- ✅ **Clear mental models** (configuration vs. actions)
- ✅ **Industry standards** for both patterns
- ✅ **User safety** with review-before-commit
- ✅ **Immediate feedback** for critical operations
