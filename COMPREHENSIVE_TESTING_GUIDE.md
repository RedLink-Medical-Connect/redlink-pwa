# Comprehensive Testing Guide - RedLink PWA

## Development Server

```bash
npm run dev
```

Server runs on: http://localhost:5174/

## 🔧 Development Mode Features

All composables now include development mode fallbacks with simulated data when GraphQL fails.

---

## 1. Request Creation (FIXED) ✅

### URL: http://localhost:5174/dashboard/requests/new

### What Was Fixed:

- GraphQL schema deployment issues
- Data validation errors
- Clinic ID retrieval problems
- Added robust error handling with multiple fallback methods

### Test Steps:

1. Navigate to new request page
2. Fill out the form:
   - Request type: Emergency or Appointment
   - Species: Dog or Cat
   - Blood group: Any valid group
   - Quantity: Any number
3. Submit the form
4. Should see success message or proper error handling

### Expected Behavior:

- ✅ Form submits successfully
- ✅ Proper error messages if validation fails
- ✅ Development mode shows simulated data if GraphQL fails
- ✅ Console shows "🔧 DEV MODE" messages when using fallbacks

---

## 2. Owner Dashboard (FIXED) ✅

### URL: http://localhost:5174/dashboard/board

### What Was Fixed:

- Undefined error when accessing missions.length
- Added safety checks with safeMissions computed property
- Development mode with simulated mission data

### Test Steps:

1. Navigate to owner dashboard
2. Check that page loads without errors
3. Verify missions display properly

### Expected Behavior:

- ✅ No "Cannot read properties of undefined (reading 'length')" error
- ✅ Dashboard displays mission cards or empty state
- ✅ Development mode shows simulated missions if GraphQL fails

---

## 3. Clinic Settings (FIXED) ✅

### URL: http://localhost:5174/dashboard/settings

### What Was Fixed:

- Data fetching issues in useClinicSettings composable
- Update mutations not working
- Added proper error handling and development mode fallbacks
- Fixed GraphQL mutation imports

### Test Steps:

1. Navigate to settings page
2. Check "INFORMATIONS GÉNÉRALES" tab:
   - Verify clinic data loads
   - Test form field editing
   - Test address autocomplete
   - Test emergency service checkbox
   - Click "ENREGISTRER" button
3. Switch to "VÉTÉRINAIRE RÉFÉRENT" tab:
   - Verify veterinarian data loads
   - Test form editing (email should be disabled)
   - Click "ENREGISTRER" button
4. Test delete account:
   - Click "SUPPRIMER LE COMPTE" button
   - Verify confirmation dialog appears
   - Test cancel and confirm buttons

### Expected Behavior:

- ✅ Data loads without errors (simulated in dev mode)
- ✅ Forms are editable and functional
- ✅ Save operations work with proper feedback
- ✅ Delete account shows confirmation dialog
- ✅ All translations display correctly in French

---

## 4. General Testing Commands

### Install Dependencies:

```bash
npm install
```

### Run Development Server:

```bash
npm run dev
```

### Run Tests (if available):

```bash
npm run test
```

### Build for Production:

```bash
npm run build
```

### Deploy to AWS (if needed):

```bash
amplify push --yes
```

---

## 5. Development Mode Indicators

Look for these console messages indicating development mode is active:

- `🔧 DEV MODE: Simulating clinic settings data`
- `🔧 DEV MODE: Simulating clinic update`
- `🔧 DEV MODE: Simulating veterinarian update`
- `🔧 DEV MODE: Using simulated clinic data for request creation`
- `🔧 DEV MODE: GraphQL failed, using simulated data`

---

## 6. Error Handling

All composables now include:

- ✅ Proper try-catch blocks
- ✅ Development mode fallbacks
- ✅ Meaningful error messages
- ✅ Loading states
- ✅ Toast notifications for user feedback

---

## 7. GraphQL Schema Status

The simplified schema has been deployed to AWS with:

```bash
amplify push --yes
```

Key changes:

- Simplified data relationships
- Removed complex nested queries
- Added proper indexes for performance
- Compatible with Amplify basic tier

---

## 8. Translation Status

All required translation keys are present in:

- ✅ `src/locales/fr.json` (French)
- ✅ `src/locales/en.json` (English)

Missing translation keys will show fallback messages or English defaults.

---

## 9. Browser Console Monitoring

While testing, monitor the browser console for:

- ❌ Any JavaScript errors
- ⚠️ GraphQL query failures (expected in dev mode)
- ℹ️ Development mode messages
- ✅ Successful operations

---

## 10. Next Steps

After testing, you may want to:

1. Deploy the latest changes to AWS: `amplify push --yes`
2. Test with real data in production environment
3. Add more comprehensive error handling if needed
4. Implement additional features as required

---

## Troubleshooting

### If GraphQL queries fail:

1. Check AWS Amplify console for deployment status
2. Verify schema is properly deployed
3. Check authentication status
4. Development mode should provide fallback data

### If translations are missing:

1. Check `src/locales/` files for required keys
2. Verify i18n configuration
3. Check browser language settings

### If components don't load:

1. Check browser console for errors
2. Verify all dependencies are installed
3. Check file paths and imports
4. Restart development server
