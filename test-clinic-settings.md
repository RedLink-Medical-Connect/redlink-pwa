# Test Plan: Clinic Settings Page

## URL to Test

http://localhost:5174/dashboard/settings

## What to Test

### 1. Data Fetching

- [ ] Page loads without errors
- [ ] Loading spinner appears initially
- [ ] In development mode, simulated data should appear:
  - Clinic name: "Clinique Vétérinaire du Centre"
  - Email: "contact@clinique-centre.fr"
  - Phone: "+33123456789"
  - RPPS: "12345678901"
  - Address: "123 Rue de la Paix, 75001 Paris"
  - Emergency service: checked

### 2. Form Functionality

- [ ] All form fields are populated with data
- [ ] Form fields are editable
- [ ] Address autocomplete works
- [ ] Phone input validation works
- [ ] Emergency service checkbox toggles

### 3. Save Functionality

- [ ] "ENREGISTRER" button works for clinic tab
- [ ] Success toast appears after saving
- [ ] Loading state shows during save operation

### 4. Veterinarian Tab

- [ ] Switch to "VÉTÉRINAIRE RÉFÉRENT" tab
- [ ] Veterinarian data loads:
  - First name: "Dr. Jean"
  - Last name: "Dupont"
  - Email: "jean.dupont@example.com" (disabled)
- [ ] Save button works for vet tab

### 5. Delete Account

- [ ] Delete account button shows confirmation dialog
- [ ] Dialog has proper warning message
- [ ] Cancel button closes dialog
- [ ] Confirm button works (in dev mode, simulates deletion)

## Expected Behavior in Development Mode

- If GraphQL fails, the composable should fall back to simulated data
- All operations should work with simulated data
- Console should show "🔧 DEV MODE" messages
- No actual GraphQL mutations should be sent for simulated data

## How to Test

1. Open http://localhost:5174/dashboard/settings
2. Check browser console for any errors
3. Verify data loads (simulated in dev mode)
4. Test form interactions
5. Test save operations
6. Test tab switching
7. Test delete account flow
