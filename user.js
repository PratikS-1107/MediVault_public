let currentUser = null;
let appointmentRefreshInterval = null;
let currentProfile = null;
let patientRecordsCache = [];
let assistantChatHistory = [];

const GEMINI_API_KEY = "AIzaSyA2nqjy0nD1fwG_EfYsIRjqxEvExcSSLNU"; // Replace with your real key

// Date formatting function
function formatDateDDMMYYYY(dateObj) {
    const d = String(dateObj.getDate()).padStart(2, '0');
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const y = dateObj.getFullYear();
    return `${d}/${m}/${y}`;
}

// Check and update appointment status to expired if time has passed
async function checkAndUpdateExpiredAppointments(appointments) {
    const now = new Date();
    const expiredIds = [];
    const restoreIds = [];

    const trackedAppointments = (appointments || []).filter(apt =>
        apt && !['completed', 'cancelled'].includes(apt.status)
    );

    const slotIds = [...new Set(trackedAppointments.map(apt => apt.slot_id).filter(Boolean))];
    let slotMap = {};

    if (slotIds.length) {
        const { data: slots, error: slotError } = await supabaseClient
            .from('doctor_availability')
            .select('id, available_date, end_time')
            .in('id', slotIds);

        if (slotError) {
            console.error('Error loading slot end times for expiry check:', slotError);
        } else {
            slotMap = Object.fromEntries((slots || []).map(slot => [slot.id, slot]));
        }
    }
    
    for (const apt of (appointments || [])) {
        if (!apt || ['completed', 'cancelled'].includes(apt.status)) continue;

        const slot = apt.slot_id ? slotMap[apt.slot_id] : null;
        let expiryTime = null;

        if (apt.slot_id) {
            if (!slot?.end_time) {
                // Slot-based appointments should only expire by slot end time.
                // If slot lookup fails, skip auto-expiry to avoid false expiration.
                continue;
            }

            const datePart = slot.available_date || String(apt.appointment_time).split('T')[0];
            const slotEnd = new Date(`${datePart}T${slot.end_time}`);
            if (Number.isNaN(slotEnd.getTime())) {
                continue;
            }
            expiryTime = slotEnd;
        } else {
            // Fallback for legacy appointments without slot_id.
            expiryTime = new Date(apt.appointment_time);
        }

        if (expiryTime < now) {
            if (apt.status !== 'expired') {
                expiredIds.push(apt.id);
            }
        } else if (apt.status === 'expired') {
            // Previously expired too early; restore while slot end time is still in future.
            restoreIds.push(apt.id);
        }
    }
    
    for (const id of expiredIds) {
        await supabaseClient
            .from('appointments')
            .update({ status: 'expired' })
            .eq('id', id);
    }

    for (const id of restoreIds) {
        await supabaseClient
            .from('appointments')
            .update({ status: 'scheduled' })
            .eq('id', id);
    }
    
    return appointments.map(apt => ({
        ...apt,
        status: expiredIds.includes(apt.id)
            ? 'expired'
            : restoreIds.includes(apt.id)
                ? 'scheduled'
                : apt.status
    }));
}

// 5. Load Appointments
async function loadAppointments() {
    console.log('Loading patient appointments...');

    // Load doctors for booking
    const { data: doctors, error: docError } = await supabaseClient
        .from('doctors')
        .select('*');

    if (docError) console.error('Error loading doctors:', docError);

    const doctorSelect = document.getElementById('book-doctor-select');
    doctorSelect.innerHTML = '<option value="">Select Doctor</option>' + (doctors || []).map(doc => `
        <option value="${doc.id}">${doc.name}</option>
    `).join('');

    // Load user's appointments
    const { data: appointments, error: aptError } = await supabaseClient
        .from('appointments')
        .select('*')
        .eq('patient_id', currentUser.id)
        .order('appointment_time', { ascending: true });

    if (aptError) {
        console.error('Error loading appointments:', aptError);
        // Don't show error to user if no appointments exist yet
        if (aptError.code !== 'PGRST116') {
            showNotification("Error loading appointments: " + aptError.message, "error");
        }
    }
    
    console.log('Loaded appointments:', appointments?.map(apt => ({ id: apt.id, status: apt.status, time: apt.appointment_time })));
    
    // Check and update expired appointments
    const updatedAppointments = await checkAndUpdateExpiredAppointments(appointments);

    // Create doctor name map
    const doctorMap = {};
    doctors.forEach(doc => doctorMap[doc.id] = doc.name);

    const appointmentsList = document.getElementById('my-appointments-list');
    appointmentsList.innerHTML = (updatedAppointments || []).length ? updatedAppointments.map(apt => `
        <div class="appointment-item" style="border: 1px solid var(--border); padding: 10px; margin-bottom: 10px; border-radius: 8px; ${apt.status === 'expired' ? 'opacity: 0.7; background: #f5f5f5;' : apt.status === 'completed' ? 'background: #f0fdf4;' : ''}">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <strong>${formatDateDDMMYYYY(new Date(apt.appointment_time))} ${new Date(apt.appointment_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - Dr. ${doctorMap[apt.doctor_id] || 'Doctor'}</strong>
                    <p>Status: <span style="font-weight: bold; ${apt.status === 'expired' ? 'color: #dc2626;' : apt.status === 'completed' ? 'color: #16a34a;' : apt.status === 'scheduled' ? 'color: #0077b6;' : 'color: #666;'}">${apt.status.charAt(0).toUpperCase() + apt.status.slice(1)}</span></p>
                </div>
                <div>
                    ${apt.status === 'scheduled' ? `<button onclick="cancelAppointment('${apt.id}')" class="btn-danger" style="font-size: 0.8rem; padding: 4px 8px;">Cancel</button>` : ''}
                </div>
            </div>
        </div>
    `).join('') : '<p>No appointments scheduled.</p>';
}

// Cancel Appointment
async function cancelAppointment(appointmentId) {
    showCancelConfirmation(appointmentId);
}

// Show custom confirmation dialog
function showCancelConfirmation(appointmentId) {
    // Remove any existing confirmation dialog
    const existingDialog = document.querySelector('.cancel-confirmation');
    if (existingDialog) {
        existingDialog.remove();
    }

    // Create confirmation dialog
    const dialog = document.createElement('div');
    dialog.className = 'cancel-confirmation';
    dialog.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;">
            <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); max-width: 400px; width: 90%;">
                <h3 style="margin: 0 0 15px 0; color: #dc2626;">Cancel Appointment</h3>
                <p style="margin: 0 0 20px 0; color: #374151;">Are you sure you want to cancel this appointment? This action cannot be undone.</p>
                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button onclick="this.closest('.cancel-confirmation').remove()" style="padding: 8px 16px; border: 1px solid #d1d5db; background: white; border-radius: 6px; cursor: pointer;">Keep Appointment</button>
                    <button onclick="confirmCancel('${appointmentId}')" style="padding: 8px 16px; background: #dc2626; color: white; border: none; border-radius: 6px; cursor: pointer;">Cancel Appointment</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(dialog);
}

// Confirm cancellation
async function confirmCancel(appointmentId) {
    // Remove the confirmation dialog
    const dialog = document.querySelector('.cancel-confirmation');
    if (dialog) dialog.remove();

    // STEP 1: Get appointment details to find the slot
    const { data: appointment, error: fetchError } = await supabaseClient
        .from('appointments')
        .select('slot_id, doctor_id, appointment_time')
        .eq('id', appointmentId)
        .single();

    if (fetchError || !appointment) {
        console.error("Error fetching appointment:", fetchError);
        showNotification("Failed to retrieve appointment details", "error");
        return;
    }

    // STEP 2: Delete the appointment
    const { error: deleteError } = await supabaseClient
        .from('appointments')
        .delete()
        .eq('id', appointmentId);

    if (deleteError) {
        console.error("Cancellation Error:", deleteError);
        showNotification("Failed to cancel: " + deleteError.message, "error");
        return;
    }

    // STEP 3: Decrement the booking count for the slot
    if (appointment.slot_id) {
        const { data: slot, error: slotFetchError } = await supabaseClient
            .from('doctor_availability')
            .select('current_bookings')
            .eq('id', appointment.slot_id)
            .single();

        if (!slotFetchError && slot && slot.current_bookings > 0) {
            const { error: updateError } = await supabaseClient
                .from('doctor_availability')
                .update({ current_bookings: slot.current_bookings - 1 })
                .eq('id', appointment.slot_id);

            if (updateError) {
                console.error("Error updating slot booking count:", updateError);
            } else {
                console.log('✓ Booking count decremented for slot', appointment.slot_id);
            }
        }
    }

    showNotification("Appointment cancelled successfully!", "success");

    // STEP 4: Refresh both appointments and available slots
    await loadAppointments();
    
    // Refresh available slots if they were being displayed
    const doctorSelect = document.getElementById('book-doctor-select');
    const dateSelect = document.getElementById('book-appointment-date');
    if (doctorSelect?.value && dateSelect?.value) {
        await loadAvailableSlots(doctorSelect.value, dateSelect.value);
    }
}

// 6. Availability and Book Appointment

function setAvailabilityLoading(isLoading) {
    const loadBtn = document.getElementById('load-availability-button');
    const slotSelect = document.getElementById('available-slot-select');
    if (loadBtn) {
        loadBtn.disabled = isLoading;
        loadBtn.innerText = isLoading ? 'Loading …' : 'Load Available Slots';
    }
    if (slotSelect) slotSelect.disabled = isLoading;
}

async function loadAvailableSlots(doctorId, date) {
    if (!doctorId || !date) {
        showNotification('Please choose doctor and date to load slots.', 'warning');
        return;
    }
    setAvailabilityLoading(true);

    const { data: slots, error } = await supabaseClient
        .from('doctor_availability')
        .select('*')
        .eq('doctor_id', doctorId)
        .eq('available_date', date)
        .order('start_time', { ascending: true });

    if (error) {
        console.error('Error loading available slots:', error);
        showNotification('Unable to load availability. Please try again.', 'error');
        setAvailabilityLoading(false);
        return;
    }

    console.log('📊 ALL SLOTS FROM DB:', slots);
    slots?.forEach(s => {
        console.log(`  Slot ${s.id}: current_bookings=${s.current_bookings} (type: ${typeof s.current_bookings}), max_capacity=${s.max_capacity}`);
    });

    const availableSlots = (slots || []).filter(s => {
        const booked = s.current_bookings || 0;
        const capacity = s.max_capacity || 1;
        const isAvailable = booked < capacity;
        console.log(`  Filter: ID=${s.id}, booked=${booked}, capacity=${capacity}, available=${isAvailable}`);
        return isAvailable;
    });
    
    console.log('✓ AVAILABLE SLOTS (after filter):', availableSlots.length);
    
    const slotSelect = document.getElementById('available-slot-select');
    const slotInfo = document.getElementById('slot-availability-info');
    if (!slotSelect) return;

    if (availableSlots.length === 0) {
        slotSelect.innerHTML = '<option value="" disabled>No slots available</option>';
        if (slotInfo) slotInfo.innerText = 'No available slots for this doctor/date. Please choose another.';
        setAvailabilityLoading(false);
        return;
    }

    slotSelect.innerHTML = '<option value="">Select a Slot</option>' + availableSlots.map(slot => {
        const booked = slot.current_bookings || 0;
        const free = slot.max_capacity - booked;
        return `<option value="${slot.id}" data-start="${slot.start_time}" data-end="${slot.end_time}">${slot.start_time} - ${slot.end_time} (${free} spots left)</option>`;
    }).join('');

    const totalAvailable = availableSlots.reduce((sum, s) => sum + Math.max(0, (s.max_capacity || 1) - (s.current_bookings || 0)), 0);
    if (slotInfo) slotInfo.innerText = `Showing ${availableSlots.length} slots, total available: ${totalAvailable} seats`;
    setAvailabilityLoading(false);
}

async function bookSlotAppointment(e) {
    e.preventDefault();

    const selectedSlotId = document.getElementById('available-slot-select')?.value;
    if (!selectedSlotId) {
        showNotification('Please select a slot before booking.', 'warning');
        return;
    }

    const { data: slot, error: slotError } = await supabaseClient
        .from('doctor_availability')
        .select('*')
        .eq('id', selectedSlotId)
        .single();

    if (slotError || !slot) {
        console.error('Error fetching slot details:', slotError);
        showNotification('Selected slot is not available. Refresh slots and try again.', 'error');
        return;
    }

    if (slot.current_bookings >= slot.max_capacity) {
        showNotification('This slot is full. Please select another slot.', 'error');
        loadAvailableSlots(slot.doctor_id, slot.available_date);
        return;
    }

    // CHECK FOR DUPLICATE BOOKING: Ensure patient doesn't already have an appointment in this slot
    const { data: existingAppointment, error: checkError } = await supabaseClient
        .from('appointments')
        .select('id')
        .eq('slot_id', selectedSlotId)
        .eq('patient_id', currentUser.id)
        .eq('status', 'scheduled')
        .single();

    if (existingAppointment) {
        showNotification('You already have an appointment in this slot. Please select a different slot.', 'warning');
        return;
    }

    const appointmentTime = new Date(`${slot.available_date}T${slot.start_time}`).toISOString();

    console.log('📞 Creating appointment directly');

    // Create appointment directly (like receptionist does)
    const appointmentData = {
        slot_id: selectedSlotId,
        patient_id: currentUser.id,
        doctor_id: slot.doctor_id,
        appointment_time: appointmentTime,
        status: 'scheduled'
    };

    const { error } = await supabaseClient.from('appointments').insert([appointmentData]);

    if (error) {
        console.error('Error creating appointment:', error);
        showNotification('Failed to book appointment: ' + error.message, 'error');
        return;
    }

    // Increment slot booking count
    const { error: updateError } = await supabaseClient
        .from('doctor_availability')
        .update({ current_bookings: (slot.current_bookings || 0) + 1 })
        .eq('id', selectedSlotId);

    if (updateError) {
        console.error('Error updating slot count:', updateError);
        // Don't show error to user as appointment was created successfully
    }

    showNotification('Appointment booked successfully!', 'success');
    loadAvailableSlots(slot.doctor_id, slot.available_date);
    loadAppointments(); // Refresh user's appointments

    if (error) {
        console.error('Booking failed:', error.message);
        showNotification('Booking failed: ' + error.message, 'error');
        return;
    }

    console.log('✓ RPC Success - Appointment booked');
    showNotification('Appointment booked successfully!', 'success');
    document.getElementById('book-appointment-form')?.reset();
    
    // Refresh UI
    await loadAppointments();
    await loadAvailableSlots(slot.doctor_id, slot.available_date);
}

const availabilityButton = document.getElementById('load-availability-button');
if (availabilityButton) {
    availabilityButton.addEventListener('click', () => {
        const doctorId = document.getElementById('book-doctor-select')?.value;
        const date = document.getElementById('book-appointment-date')?.value;
        loadAvailableSlots(doctorId, date);
    });
}

const bookForm = document.getElementById('book-appointment-form');
if (bookForm) {
    bookForm.addEventListener('submit', bookSlotAppointment);
}

// Initialize Dashboard
document.addEventListener('DOMContentLoaded', async () => {
    currentUser = await checkAuth();
    if (!currentUser) return;

    // Verify role with proper redirect
    if (currentUser.user_metadata.role === 'doctor') {
        window.location.href = 'doctor.html';
        return;
    }
    if (currentUser.user_metadata.role === 'receptionist') {
        window.location.href = 'receptionist.html';
        return;
    }
    if (currentUser.user_metadata.role !== 'patient') {
        // Unknown role fallback
        window.location.href = 'index.html';
        return;
    }

    loadProfileData();
    loadRecords();
    loadLogs();
    loadAppointments();
    setupTabSwitching();

    // Set up appointment refresh interval (every 30 seconds)
    appointmentRefreshInterval = setInterval(() => {
        if (document.querySelector('#my-appointments-list')) {
            loadAppointments();
        }
    }, 30000);
    window.appointmentRefreshInterval = appointmentRefreshInterval;
});

// Tab Switching Logic
function setupTabSwitching() {
    const tabs = document.querySelectorAll('.nav-tab');
    const contents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.preventDefault();
            const target = tab.getAttribute('data-target');

            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.classList.add('hidden'));

            tab.classList.add('active');
            document.getElementById(target).classList.remove('hidden');

            // Refresh appointments when appointments tab is clicked
            if (target === 'user-appointments') {
                loadAppointments();
            }
        });
    });
}

async function analyzeSymptoms() {
    const input = document.getElementById('symptom-input').value.trim();
    const resultBox = document.getElementById('ai-result-box');
    const responseText = document.getElementById('ai-response-text');
    const specialistValue = document.getElementById('ai-specialist-value');
    const btn = document.getElementById('analyze-btn');

    if (!input) return showNotification("Please describe your symptoms.", "info");

    btn.disabled = true;
    btn.innerText = "Analyzing...";
    resultBox.classList.remove('hidden');
    responseText.innerHTML = "<em>MediVault AI is analyzing your symptoms...</em>";

    // 1. Use the EXACT model from your working curl
    const MODEL = "gemini-flash-latest";
    const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

    try {
        const response = await fetch(URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-goog-api-key': GEMINI_API_KEY
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: `Context: Medical Symptom Checker. User symptoms: "${input}". \nTask: Provide possible causes, urgency level, recommended specialist, and advice. \nConstraint: Keep it brief and include a medical disclaimer that says: \"I am not a doctor. For true medical emergencies call 102 or your local emergency number.\"` 
                    }]
                }]
            })
        });

        const data = await response.json();

        if (data.error) {
            console.error("API Error:", data.error);
            responseText.innerHTML = `<span style="color:red;">Error ${data.error.code}: ${data.error.message}</span>`;
            return;
        }

        if (data.candidates && data.candidates[0].content.parts[0].text) {
            const aiText = data.candidates[0].content.parts[0].text;
            responseText.innerHTML = aiText
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\n/g, '<br>');

            specialistValue.innerText = extractSpecialist(aiText);
        } else {
            responseText.innerHTML = "AI could not generate a response. Try describing symptoms differently.";
            specialistValue.innerText = 'General physician';
        }

    } catch (err) {
        console.error("Fetch failure:", err);
        responseText.innerHTML = "Connection failed. Please check your internet.";
        specialistValue.innerText = 'General physician';
    } finally {
        btn.disabled = false;
        btn.innerText = "Analyze Symptoms";
    }
}

function extractSpecialist(aiText) {
    if (!aiText || typeof aiText !== 'string') return 'General physician';

    // First, try to extract multiple specialists from a list format
    // e.g., "Recommended Specialist:\n* Gastroenterologist\n* Urologist"
    const listPattern = /(?:Recommended specialist|Suggested specialist|Specialist recommendation)[:\s]*\n(?:\*\s*)?([^\n*]+)/i;
    let match = aiText.match(listPattern);
    if (match && match[1]) {
        let value = match[1].trim();
        value = value.replace(/\s*\(.+?\)/g, '').trim(); // Remove descriptions in parentheses
        if (value.length > 0 && value.split(' ').length <= 4) {
            return value;
        }
    }

    // Try to extract all bullet-pointed specialists
    const bulletsPattern = /(?:Recommended specialist|Suggested specialist|Specialist recommendation)[:\s]*\n([\s\S]*?)(?:\n\n|Advice|$)/i;
    const bulletsMatch = aiText.match(bulletsPattern);
    if (bulletsMatch && bulletsMatch[1]) {
        const bulletLines = bulletsMatch[1].split('\n').filter(line => line.trim().startsWith('*'));
        if (bulletLines.length > 0) {
            // Extract first specialist from bullet list
            const firstBullet = bulletLines[0];
            const specialistMatch = firstBullet.match(/\*\s*([^(]+)/);
            if (specialistMatch && specialistMatch[1]) {
                return specialistMatch[1].trim();
            }
        }
    }

    const candidatePatterns = [
        /(?:Recommended specialist|Suggested specialist|Specialist recommendation|Consult a)[:\s]*([^\.\n\r]+)/i,
        /(?:See a|Visit a)[:\s]*([^\.\n\r]+)/i,
    ];

    for (const pattern of candidatePatterns) {
        match = aiText.match(pattern);
        if (match && match[1]) {
            let value = match[1].trim();
            value = value.replace(/\s*\./g, '').trim();
            if (value.length > 0 && value.split(' ').length <= 4 && !/\b(if|and|or|then|because)\b/i.test(value)) {
                return value;
            }
        }
    }

    const specialties = ['cardiologist', 'dermatologist', 'neurologist', 'orthopedist', 'pediatrician', 'psychiatrist', 'gastroenterologist', 'endocrinologist', 'pulmonologist', 'opthalmologist', 'ophthalmologist', 'ENT', 'urologist', 'rheumatologist', 'oncologist', 'general physician', 'internist'];

    const lowerText = aiText.toLowerCase();
    for (const s of specialties) {
        if (lowerText.includes(s.toLowerCase())) {
            return s.charAt(0).toUpperCase() + s.slice(1);
        }
    }

    return 'General physician';
}

// 1. Load Profile Data
async function loadProfileData() {
    const { data, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', currentUser.id)
        .single();

    if (data) {
        currentProfile = data;
        const welcomeNameEl = document.getElementById('welcome-name');
        if (welcomeNameEl) welcomeNameEl.innerText = `Welcome, ${data.name}`;

        const displayIdEl = document.getElementById('display-id');
        if (displayIdEl) displayIdEl.innerText = data.id;

        const ageEl = document.getElementById('p-age');
        if (ageEl) ageEl.innerText = data.age || '-';

        const genderEl = document.getElementById('p-gender');
        if (genderEl) genderEl.innerText = data.gender || '-';

        const bloodEl = document.getElementById('p-blood');
        if (bloodEl) bloodEl.innerText = data.blood_group || '-';

        const emergencyEl = document.getElementById('p-emergency');
        if (emergencyEl) emergencyEl.innerText = data.emergency_contact || '-';

        // Handle arrays for display
        const chronicDisplay = Array.isArray(data.chronic_illnesses) ? data.chronic_illnesses.join(', ') : (data.chronic_illnesses || 'None');
        const allergiesDisplay = Array.isArray(data.allergies) ? data.allergies.join(', ') : (data.allergies || 'None');
        const medsDisplay = Array.isArray(data.current_medications) ? data.current_medications.join(', ') : (data.current_medications || '-');

        const chronicEl = document.getElementById('p-chronic');
        if (chronicEl) chronicEl.innerText = chronicDisplay;

        const allergiesEl = document.getElementById('p-allergies');
        if (allergiesEl) allergiesEl.innerText = allergiesDisplay;

        const medsEl = document.getElementById('p-meds');
        if (medsEl) medsEl.innerText = medsDisplay;


        const setName = document.getElementById('set-name');
        if (setName) setName.value = data.name || '';
        const setAge = document.getElementById('set-age');
        if (setAge) setAge.value = data.age || '';
        const setGender = document.getElementById('set-gender');
        if (setGender) setGender.value = data.gender || '';
        const setBlood = document.getElementById('set-blood');
        if (setBlood) setBlood.value = data.blood_group || '';
        const setEmergency = document.getElementById('set-emergency');
        if (setEmergency) setEmergency.value = data.emergency_contact || '';
        const setChronic = document.getElementById('set-chronic');
        if (setChronic) setChronic.value = Array.isArray(data.chronic_illnesses) ? data.chronic_illnesses.join(', ') : (data.chronic_illnesses || '');
        const setAllergies = document.getElementById('set-allergies');
        if (setAllergies) setAllergies.value = Array.isArray(data.allergies) ? data.allergies.join(', ') : (data.allergies || '');
        const setMeds = document.getElementById('set-meds');
        if (setMeds) setMeds.value = Array.isArray(data.current_medications) ? data.current_medications.join(', ') : (data.current_medications || '');
    }
}

// 2. Upload Record
async function uploadRecord() {
    const fileInput = document.getElementById('pdf-upload');
    const file = fileInput.files[0];
    if (!file) return showNotification("Please select a PDF file first", 'warning');

    const btn = document.getElementById('upload-btn');
    btn.disabled = true;
    btn.classList.add('loading');
    btn.innerText = "Uploading...";

    const fileName = `${Date.now()}_${file.name}`;
    const filePath = `${currentUser.id}/${fileName}`;

    // 1. Upload to Storage
    const { data: storageData, error: storageError } = await supabaseClient
        .storage
        .from('medical_records')
        .upload(filePath, file);

    if (storageError) {
        showNotification(storageError.message, "error");
        btn.disabled = false;
        btn.innerText = "Upload to Vault";
        return;
    }

    // --- STEP 2: ADD TO DATABASE TABLE ---
    const { error: dbError } = await supabaseClient
        .from('medical_records')
        .insert([{
            patient_id: currentUser.id,
            file_name: file.name,
            file_url: filePath
        }]);

    if (dbError) {
        console.error("Database Error:", dbError);
    // Delete the file from storage since db insert failed
    await supabaseClient.storage.from('medical_records').remove([filePath]);
        showNotification("Failed to save record: " + dbError.message, "error");
        fileInput.value = ""; // Clear the input
    } else {
        showNotification("Record saved successfully!", "success");
        fileInput.value = ""; // Clear the input
        loadRecords();       // Trigger your function that refreshes the table on screen
    }

    btn.disabled = false;
    btn.innerText = "Upload to Vault";
}

// 3. Load Records
async function loadRecords() {
    const recordList = document.getElementById('record-list');
    recordList.innerHTML = '<p>Loading records...</p>';

    // 1. Fetch records from the 'medical_records' table for this user
    const { data: records, error } = await supabaseClient
        .from('medical_records')
        .select('*')
        .eq('patient_id', currentUser.id)
        .order('upload_date', { ascending: false });

    console.log('Records fetched:', records);
    console.log('Error:', error);

    if (error) {
        recordList.innerHTML = `<p class="error">Error: ${error.message}</p>`;
        patientRecordsCache = [];
        return;
    }

    if (!records || records.length === 0) {
        patientRecordsCache = [];
        recordList.innerHTML = '<p>No records found. Upload your first document!</p>';
        return;
    }

    patientRecordsCache = records;

    // 2. Build the list
    recordList.innerHTML = '';
    records.forEach(record => {
        const fileRow = document.createElement('div');
        fileRow.className = 'record-item card';
        fileRow.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <i class="fas fa-file-pdf"></i>
                    <strong>${record.file_name}</strong>
                    <small>(${formatDateDDMMYYYY(new Date(record.upload_date))})</small>
                </div>
                <div class="actions">
                    <button onclick="downloadFile('${record.file_url}')" class="btn-primary">Download</button>
                    <button onclick="deleteRecord('${record.id}', '${record.file_url}')" class="btn-danger">Delete</button>
                </div>
            </div>
        `;
        recordList.appendChild(fileRow);
    });
}

// Helper to Delete Record
async function deleteRecord(recordId, filePath) {
    // 1. Delete from Database Table
    const { error: dbError } = await supabaseClient
        .from('medical_records')
        .delete()
        .eq('id', recordId);

    if (dbError) return showNotification("Delete failed: " + dbError.message, "error");

    // 2. Delete from Storage Bucket only for bucket-backed files
    if (typeof filePath === 'string' && !filePath.startsWith('data:')) {
        const { error: storageError } = await supabaseClient
            .storage
            .from('medical_records')
            .remove([filePath]);

        if (storageError) {
            console.error('Storage delete warning:', storageError.message);
        }
    }

    loadRecords(); // Refresh the UI
    showNotification("Record fully removed", "success");
}

// Helper to Download File
async function downloadFile(fileUrl) {
    const a = document.createElement('a');
    if (typeof fileUrl === 'string' && fileUrl.startsWith('data:')) {
        a.href = fileUrl;
        a.download = 'MediVault_Prescription.pdf';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return;
    }

    const { data, error } = await supabaseClient
        .storage
        .from('medical_records')
        .download(fileUrl);

    if (error) {
        showNotification("Error downloading file: " + error.message, "error");
        return;
    }

    const url = URL.createObjectURL(data);
    a.href = url;
    a.download = fileUrl.split('/').pop(); // Extract filename from path
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// 4. Load Logs (Audit Logs and Prescriptions)
async function loadLogs() {
    // Fetch Audit Logs
    const { data: logs, error: logsError } = await supabaseClient
        .from('audit_logs')
        .select('*, doctors(name)')
        .eq('patient_id', currentUser.id);

    if (logsError) console.error('Error loading audit logs:', logsError);

    // Sort logs by timestamp descending (most recent first)
    const sortedLogs = (logs || []).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const logsTbody = document.getElementById('logs-table-body');
    logsTbody.innerHTML = sortedLogs.map(log => `
        <tr style="border-bottom: 1px solid var(--border);">
            <td style="padding: 12px; text-align: left; width: 20%;">${log.doctor_id ? 'Dr. ' + (log.doctors?.name || 'Doctor') : 'System'}</td>
            <td style="padding: 12px; text-align: left; width: 50%;">${log.action}</td>
            <td style="padding: 12px; text-align: left; width: 30%;">${formatDateDDMMYYYY(new Date(log.timestamp))} ${new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
        </tr>
    `).join('');

    // Fetch Prescriptions
    const { data: prescriptions, error: prescError } = await supabaseClient
        .from('prescriptions')
        .select('*, doctors(name)')
        .eq('patient_id', currentUser.id);

    if (prescError) console.error('Error loading prescriptions:', prescError);

    const prescList = document.getElementById('prescriptions-list');
    prescList.innerHTML = (prescriptions || []).length ? prescriptions.map(p => `
        <div style="border: 1px solid var(--border); padding: 10px; margin-bottom: 10px; border-radius: 8px;">
            <strong>${p.medication_name}</strong> - Dosage: ${p.dosage}, Duration: ${p.course_duration}<br>
            <small>Prescribed by Dr. ${p.doctors?.name || 'Unknown'} on ${formatDateDDMMYYYY(new Date(p.date_prescribed))}</small>
        </div>
    `).join('') : '<p>No prescriptions found.</p>';

    // Fetch Ordered Tests
    const { data: orderedTests, error: testsError } = await supabaseClient
        .from('tests')
        .select('*, profiles(name)')
        .eq('patient_id', currentUser.id);

    if (testsError) console.error('Error loading ordered tests:', testsError);

    const testsList = document.getElementById('ordered-tests-list');
    testsList.innerHTML = (orderedTests || []).length ? orderedTests.map(t => `
        <div style="border: 1px solid var(--border); padding: 10px; margin-bottom: 10px; border-radius: 8px;">
            <strong>${t.test_name}</strong><br>
            <small>Ordered by Dr. ${t.profiles?.name || 'Unknown'} on ${formatDateDDMMYYYY(new Date(t.created_at))}</small>
        </div>
    `).join('') : '<p>No tests ordered.</p>';
}

// 5. Update Privacy & Profile
async function updatePrivacy() {
    const val = document.getElementById('privacy-toggle').value;
    const { error } = await supabaseClient.from('profiles').update({ record_visibility: val }).eq('id', currentUser.id);
    if (error) {
        showNotification("Error updating privacy: " + error.message, 'error');
    } else {
        showNotification("Privacy mode updated!", 'success');
    }
}

// Emergency contact validation - only allow digits
document.getElementById('set-emergency')?.addEventListener('input', (e) => {
    // Remove any non-digit characters
    e.target.value = e.target.value.replace(/\D/g, '');
    
    // Limit to 10 digits
    if (e.target.value.length > 10) {
        e.target.value = e.target.value.slice(0, 10);
    }
});

document.getElementById('update-info-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    // Clear any existing notifications
    const existingNotification = document.querySelector('.profile-notification');
    if (existingNotification) {
        existingNotification.remove();
    }

    const emergencyContact = document.getElementById('set-emergency').value;

    // Validate emergency contact
    if (emergencyContact && emergencyContact.length !== 10) {
        showNotification('Emergency contact must be exactly 10 digits', 'error');
        return;
    }

    const updates = {
        name: document.getElementById('set-name').value,
        age: parseInt(document.getElementById('set-age').value) || null,
        gender: document.getElementById('set-gender').value,
        blood_group: document.getElementById('set-blood').value,
        emergency_contact: emergencyContact || null,
        chronic_illnesses: document.getElementById('set-chronic').value ? document.getElementById('set-chronic').value.split(',').map(s => s.trim()) : [],
        allergies: document.getElementById('set-allergies').value ? document.getElementById('set-allergies').value.split(',').map(s => s.trim()) : [],
        current_medications: document.getElementById('set-meds').value ? document.getElementById('set-meds').value.split(',').map(s => s.trim()) : [],
    };

    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Updating...';
    submitBtn.disabled = true;

    const { error } = await supabaseClient.from('profiles').update(updates).eq('id', currentUser.id);

    submitBtn.textContent = originalText;
    submitBtn.disabled = false;

    if (!error) {
        showNotification("Profile updated successfully!", "success");
        loadProfileData();
    } else {
        showNotification(error.message, "error");
    }
});

function toggleChat() {
    const chatBody = document.getElementById('chat-body');
    const chatIcon = document.getElementById('chat-icon');

    if (!chatBody || !chatIcon) return;

    const isHidden = chatBody.classList.contains('hidden');
    chatBody.classList.toggle('hidden');
    chatIcon.classList.toggle('fa-chevron-up', !isHidden);
    chatIcon.classList.toggle('fa-chevron-down', isHidden);

    if (isHidden) {
        const chatInput = document.getElementById('chat-input');
        setTimeout(() => chatInput?.focus(), 0);

        if (!document.querySelector('#chat-messages .chat-message')) {
            appendMessage('system', 'Hi, I am MediVault AI Assistant. Ask me about the Dashboard, Appointments, Records, Activity, Symptom Checker, or Settings tabs.');
        }
    }
}

function appendMessage(sender, text) {
    const messages = document.getElementById('chat-messages');
    if (!messages) return;

    const message = document.createElement('div');
    message.className = `chat-message ${sender}`;
    message.textContent = text;
    messages.appendChild(message);
    messages.scrollTop = messages.scrollHeight;
}

function clearAssistantChat() {
    const messages = document.getElementById('chat-messages');
    if (!messages) return;

    messages.innerHTML = '';
    assistantChatHistory = [];
    appendMessage('system', 'Chat cleared. Ask me about appointments, records, activity, settings, or symptoms.');
}

async function copyLastAssistantMessage() {
    const messages = [...document.querySelectorAll('#chat-messages .chat-message.bot')];
    const lastBotMessage = messages[messages.length - 1];

    if (!lastBotMessage) {
        showNotification('No assistant reply to copy yet.', 'warning');
        return;
    }

    try {
        await navigator.clipboard.writeText(lastBotMessage.textContent.trim());
        showNotification('Assistant reply copied to clipboard.', 'success');
    } catch (error) {
        console.error('Copy failed:', error);
        showNotification('Unable to copy right now.', 'error');
    }
}

function renderAssistantQuickActions() {
    const container = document.getElementById('chat-quick-actions');
    if (!container) return;

    const prompts = [
        { label: 'Appointments', prompt: 'How do I book an appointment?' },
        { label: 'Records', prompt: 'How do I upload a medical record?' },
        { label: 'Activity', prompt: 'Where can I see prescriptions and tests?' },
        { label: 'Settings', prompt: 'How do I update my profile?' },
        { label: 'Symptoms', prompt: 'How do I use the symptom checker?' }
    ];

    container.innerHTML = prompts.map(item => `
        <button type="button" class="chat-chip" onclick="sendQuickAssistantPrompt('${item.prompt.replace(/'/g, "\\'")}')">${item.label}</button>
    `).join('');
}

function sendQuickAssistantPrompt(prompt) {
    const input = document.getElementById('chat-input');
    if (!input) return;

    input.value = prompt;
    sendChatMessage();
}

function getDashboardGuide() {
    return [
        'You are MediVault AI Assistant, the in-app guide for the patient dashboard.',
        'Answer using the exact dashboard structure and buttons below when relevant.',
        'Dashboard tabs: Dashboard, Appointments, Records, Activity, Symptom Checker, Settings.',
        'Dashboard tab details: shows Age, Gender, Blood Group, Emergency Contact, Chronic Illnesses, Allergies, and Current Medications cards.',
        'Appointments tab details: use the Doctor dropdown, Date picker, Load Available Slots button, Available Time Slots dropdown, and Book Appointment button.',
        'Records tab details: use Upload Medical Record, choose a PDF, press Upload to Vault, then manage stored documents with Download and Delete.',
        'Activity tab details: shows Record Access History, Prescriptions, and Ordered Tests.',
        'Symptom Checker tab details: type symptoms in the text area and press Analyze Symptoms.',
        'Settings tab details: use Update Profile fields for name, age, gender, blood group, emergency contact, chronic illnesses, allergies, and current medications, then press Update Profile. Use Logout to sign out.',
        'If the user asks where something is, name the tab and the exact button or field.',
        'If a request is unclear, explain the shortest path through the dashboard rather than giving a generic answer.',
        'Do not claim to have accessed data or actions that are not visible in the dashboard.'
    ].join(' ');
}

function getAssistantQuickReply(message) {
    const text = message.toLowerCase();

    if (/(where|how).*(book|appointment|schedule)/.test(text) || /appointments?/.test(text)) {
        return 'Open the Appointments tab, pick a doctor and date, press Load Available Slots, choose a time, then Book Appointment.';
    }

    if (/(upload|record|pdf|document)/.test(text)) {
        return 'Go to the Records tab, choose your PDF file, and press Upload to Vault. After upload, your documents appear in Stored Documents.';
    }

    if (/(profile|settings|update my info|change my details)/.test(text)) {
        return 'Open Settings, use the Update Profile form, then press Update Profile when you are done.';
    }

    if (/(logs|history|activity|prescription|test)/.test(text)) {
        return 'Check the Activity tab. It contains Record Access History, Prescriptions, and Ordered Tests.';
    }

    if (/(symptom|symptoms|checker|analyse|analyze)/.test(text)) {
        return 'Use the Symptom Checker tab, describe your symptoms in the text area, and press Analyze Symptoms.';
    }

    if (/(logout|sign out)/.test(text)) {
        return 'Use the Logout button in Settings to sign out of MediVault.';
    }

    return '';
}

function buildAssistantContext() {
    const profile = currentProfile || {};
    const recordNames = (patientRecordsCache || []).map(record => record.file_name).filter(Boolean);
    const recordSummary = recordNames.length ? recordNames.slice(0, 5).join(', ') : 'No medical records uploaded yet.';

    return [
        getDashboardGuide(),
        `User name: ${profile.name || currentUser?.user_metadata?.name || 'Patient'}.`,
        'User role: patient.',
        `Current date: ${formatDateDDMMYYYY(new Date())}.`,
        `Known profile details: age=${profile.age || 'unknown'}, gender=${profile.gender || 'unknown'}, blood group=${profile.blood_group || 'unknown'}.`,
        `Current records: ${recordSummary}.`,
        'When answering, prefer concrete navigation instructions tied to the visible tabs, fields, and buttons.',
        'Keep responses concise, helpful, and specific to MediVault.',
        'Do not claim to be a doctor or diagnose medical conditions.',
        'If symptoms suggest an emergency, advise immediate emergency care.'
    ].join(' ');
}

function shouldEscalateEmergency(message) {
    return /\b(chest pain|difficulty breathing|shortness of breath|severe bleeding|unconscious|stroke|heart attack|seizure|fainting|suicidal|overdose)\b/i.test(message);
}

async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const message = input?.value.trim();
    if (!message) return;

    appendMessage('user', message);
    input.value = '';

    if (shouldEscalateEmergency(message)) {
        const emergencyText = 'This sounds like a medical emergency. Call emergency services or go to the nearest hospital immediately.';
        appendMessage('system', emergencyText);
        assistantChatHistory.push({ role: 'user', text: message }, { role: 'assistant', text: emergencyText });
        return;
    }

    const quickReply = getAssistantQuickReply(message);
    if (quickReply) {
        appendMessage('bot', quickReply);
        assistantChatHistory.push({ role: 'user', text: message }, { role: 'assistant', text: quickReply });
        return;
    }

    const context = buildAssistantContext();
    const conversation = assistantChatHistory.slice(-8).map(item => `${item.role === 'user' ? 'User' : 'Assistant'}: ${item.text}`).join('\n');

    try {
        appendMessage('system', 'MediVault AI Assistant is thinking...');

        const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-goog-api-key': GEMINI_API_KEY
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: `${context}\n\nConversation so far:\n${conversation || 'No prior conversation.'}\n\nUser question: ${message}\n\nReply as MediVault AI Assistant in 2 to 6 short sentences. If the question is about the dashboard, mention the exact tab, field, or button. If it is about health symptoms, keep it general and safe.`
                    }]
                }]
            })
        });

        const data = await response.json();
        const aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'I could not generate a response right now. Please try again.';

        const typingNotice = [...document.querySelectorAll('#chat-messages .chat-message.system')].find(node => node.textContent === 'MediVault AI Assistant is thinking...');
        if (typingNotice) typingNotice.remove();

        appendMessage('bot', aiText);
        assistantChatHistory.push({ role: 'user', text: message }, { role: 'assistant', text: aiText });
    } catch (error) {
        const typingNotice = [...document.querySelectorAll('#chat-messages .chat-message.system')].find(node => node.textContent === 'MediVault AI Assistant is thinking...');
        if (typingNotice) typingNotice.remove();

        console.error('Chat assistant error:', error);
        appendMessage('bot', "I'm having trouble connecting right now. Please try again in a moment.");
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                sendChatMessage();
            }
        });
    }

    renderAssistantQuickActions();

    if (!document.querySelector('#chat-messages .chat-message')) {
        appendMessage('system', 'Hi, I am MediVault AI Assistant. Use the quick prompts above or ask me about the Dashboard, Appointments, Records, Activity, Symptom Checker, or Settings tabs.');
    }
});
