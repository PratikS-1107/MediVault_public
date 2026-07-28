let currentDoctor = null;
let activePatientId = null;
let activeConsultation = null; // Track active consultation {patientId, appointmentId, modal}

function cloneConsultationItems(items) {
    return (items || []).map(item => ({ ...item }));
}

function getConsultationPdfFileName(patientName, appointmentId) {
    const safePatientName = (patientName || 'Patient').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'Patient';
    const consultationId = (appointmentId || 'Consultation').toString().split('-')[0].toUpperCase();
    return `MediVault_Prescription_${safePatientName}_${consultationId}.pdf`;
}

function getConsultationItemLists() {
    if (!activeConsultation) {
        return { prescriptions: [], tests: [] };
    }

    return {
        prescriptions: cloneConsultationItems(activeConsultation.prescriptions),
        tests: cloneConsultationItems(activeConsultation.tests)
    };
}

function buildPrescriptionRows(prescriptions) {
    if (!prescriptions || prescriptions.length === 0) {
        return [['No medication prescribed', '-', '-']];
    }

    return prescriptions.map(item => [
        item.medication_name || '-',
        item.dosage || '-',
        item.course_duration || '-'
    ]);
}

function buildTestRows(tests) {
    if (!tests || tests.length === 0) {
        return [['No tests ordered', '-']];
    }

    return tests.map(item => [
        item.test_name || '-',
        'Ordered'
    ]);
}

async function saveConsultationPdfToPatientRecords(consultationSnapshot, pdfDataUrl) {
    if (!consultationSnapshot?.patientId || !pdfDataUrl) {
        return { saved: false, error: new Error('Missing patient or PDF data') };
    }

    const fileName = getConsultationPdfFileName(consultationSnapshot.patientName, consultationSnapshot.appointmentId);

    const { error: dbError } = await supabaseClient
        .from('medical_records')
        .insert([{
            patient_id: consultationSnapshot.patientId,
            file_name: fileName,
            file_url: pdfDataUrl
        }]);

    if (dbError) {
        return { saved: false, error: dbError };
    }

    return { saved: true, fileName };
}

async function generateMedicalPDF(consultationSnapshot) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
        showNotification('PDF generator is not available right now.', 'error');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;
    const patientName = consultationSnapshot?.patientName || consultationSnapshot?.patientDetails?.name || 'Patient';
    const doctorName = consultationSnapshot?.doctorName || `Dr. ${currentDoctor?.user_metadata?.name || 'Doctor'}`;
    const consultationDate = consultationSnapshot?.completedAt || new Date();
    const consultationId = (consultationSnapshot?.appointmentId || 'CONSULTATION').toString().split('-')[0].toUpperCase();
    const prescriptions = consultationSnapshot?.prescriptions || [];
    const tests = consultationSnapshot?.tests || [];

    doc.setFillColor(0, 119, 182);
    doc.rect(0, 0, pageWidth, 28, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('MediVault Medical Prescription', pageWidth / 2, 12, { align: 'center' });
    doc.setFontSize(9);
    doc.text('Professional Consultation Summary', pageWidth / 2, 20, { align: 'center' });

    doc.setTextColor(90, 90, 90);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString()}`, pageWidth - 14, 36, { align: 'right' });

    doc.setDrawColor(0, 119, 182);
    doc.line(14, 40, pageWidth - 14, 40);

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Patient Information', 14, 50);
    doc.setFont('helvetica', 'normal');
    doc.text(`Name: ${patientName}`, 14, 58);
    doc.text(`Patient ID: ${consultationSnapshot?.patientId || '-'}`, 14, 65);
    doc.text(`Visit Date: ${formatDateDDMMYYYY(new Date())}`, 14, 72);

    doc.setFont('helvetica', 'bold');
    doc.text('Doctor Information', pageWidth / 2 + 6, 50);
    doc.setFont('helvetica', 'normal');
    doc.text(`Assigned Doctor: ${doctorName}`, pageWidth / 2 + 6, 58);
    doc.text(`Appointment ID: ${consultationId}`, pageWidth / 2 + 6, 65);
    doc.text(`Consultation Completed: ${consultationDate.toLocaleString()}`, pageWidth / 2 + 6, 72);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Prescribed Medicines', 14, 86);

    doc.autoTable({
        startY: 90,
        head: [['Medicine', 'Dosage', 'Duration']],
        body: buildPrescriptionRows(prescriptions),
        theme: 'striped',
        styles: { font: 'helvetica', fontSize: 10, cellPadding: 4 },
        headStyles: { fillColor: [0, 119, 182], textColor: 255 },
        alternateRowStyles: { fillColor: [245, 250, 255] },
        margin: { left: 14, right: 14 }
    });

    let nextY = doc.lastAutoTable?.finalY ? doc.lastAutoTable.finalY + 12 : 120;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Ordered Tests', 14, nextY);

    doc.autoTable({
        startY: nextY + 4,
        head: [['Test Name', 'Status']],
        body: buildTestRows(tests),
        theme: 'grid',
        styles: { font: 'helvetica', fontSize: 10, cellPadding: 4 },
        headStyles: { fillColor: [69, 123, 157], textColor: 255 },
        alternateRowStyles: { fillColor: [250, 252, 255] },
        margin: { left: 14, right: 14 }
    });

    nextY = doc.lastAutoTable?.finalY ? doc.lastAutoTable.finalY + 16 : nextY + 16;
    if (nextY > pageHeight - 32) nextY = pageHeight - 32;

    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(90, 90, 90);
    doc.text('This is a digitally generated medical document from MediVault.', pageWidth / 2, pageHeight - 18, { align: 'center' });
    doc.line(14, pageHeight - 28, 90, pageHeight - 28);
    doc.line(pageWidth - 90, pageHeight - 28, pageWidth - 14, pageHeight - 28);
    doc.setFont('helvetica', 'normal');
    doc.text('Doctor Signature', 14, pageHeight - 22);
    doc.text('Patient Copy', pageWidth - 14, pageHeight - 22, { align: 'right' });

    const fileName = getConsultationPdfFileName(patientName, consultationSnapshot?.appointmentId);
    const pdfDataUrl = doc.output('datauristring');
    const saveResult = await saveConsultationPdfToPatientRecords(consultationSnapshot, pdfDataUrl);
    if (saveResult.saved) {
        showNotification('Prescription PDF saved to patient records.', 'success');
    } else {
        console.error('Failed to save consultation PDF:', saveResult.error);
        showNotification('PDF was generated, but saving to patient records failed: ' + saveResult.error.message, 'warning');
    }

    doc.save(fileName);
}

/**
 * NOTIFICATION HELPER: Shows fixed-position toast notifications
 */
function showNotification(message, type = 'info', duration = 5000) {
    // Get or create toast container (fixed position at top-right)
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = 'position: fixed; top: 80px; right: 25px; z-index: 10000; display: flex; flex-direction: column; gap: 12px; pointer-events: none;';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.style.cssText = 'pointer-events: auto; min-width: 320px; background: white; padding: 16px; border-radius: 10px; box-shadow: 0 10px 25px rgba(0,0,0,0.15); display: flex; align-items: center; gap: 12px; animation: slideIn 0.3s ease-out forwards;';

    let icon = 'ℹ️';
    let borderColor = '#ccc';
    
    if (type === 'success') {
        icon = '✅';
        borderColor = '#22c55e';
        toast.style.background = '#f0fdf4';
        toast.style.color = '#166534';
    } else if (type === 'error') {
        icon = '❌';
        borderColor = '#ef4444';
        toast.style.background = '#fef2f2';
        toast.style.color = '#991b1b';
    } else if (type === 'warning') {
        icon = '⚠️';
        borderColor = '#f59e0b';
        toast.style.background = '#fffbeb';
        toast.style.color = '#92400e';
    }

    toast.style.borderLeft = `6px solid ${borderColor}`;

    toast.innerHTML = `
        <span style="font-size: 1.5em;">${icon}</span>
        <div style="flex-grow: 1; padding-right: 10px;">${message}</div>
        <i class="fas fa-times" style="cursor: pointer; opacity: 0.5;" onclick="this.parentElement.remove()"></i>
    `;

    container.appendChild(toast);

    // Auto-remove after duration
    setTimeout(() => {
        if (toast.parentNode) {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(20px)';
            toast.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
            setTimeout(() => {
                if (toast.parentNode) toast.remove();
            }, 500);
        }
    }, duration);
}

document.addEventListener('DOMContentLoaded', async () => {
    currentDoctor = await checkAuth();
    if (!currentDoctor) return;

    if (currentDoctor.user_metadata.role === 'patient') {
        window.location.href = 'user.html';
        return;
    }
    if (currentDoctor.user_metadata.role === 'receptionist') {
        window.location.href = 'receptionist.html';
        return;
    }
    if (currentDoctor.user_metadata.role !== 'doctor') {
        window.location.href = 'index.html';
        return;
    }

    document.getElementById('doc-welcome').innerText = `Welcome, Dr. ${currentDoctor.user_metadata.name}`;
    setupTabSwitching();
    loadDoctorAppointments();
    loadDoctorHistory();
});

function setupTabSwitching() {
    const tabs = document.querySelectorAll('.nav-tab');
    const contents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.preventDefault();

            // Check if there's an active consultation
            if (activeConsultation && tab.getAttribute('data-target') !== 'doctor-home') {
                showConfirmationModal(
                    "You have an active consultation in progress. Switching tabs will close the consultation without saving. Do you want to continue?",
                    () => {
                        // Close the active consultation
                        activeConsultation.modal.remove();
                        activeConsultation = null;
                        updateActiveConsultationDisplay();
                        showNotification("Consultation closed without saving.", "warning");

                        // Now switch the tab
                        tabs.forEach(t => t.classList.remove('active'));
                        contents.forEach(c => c.classList.add('hidden'));
                        tab.classList.add('active');
                        document.getElementById(tab.getAttribute('data-target')).classList.remove('hidden');
                    }
                );
                return; // Don't switch tabs immediately, wait for confirmation
            }

            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.classList.add('hidden'));
            tab.classList.add('active');
            document.getElementById(tab.getAttribute('data-target')).classList.remove('hidden');
        });
    });
}

// SEARCH PATIENT LOGIC (kept for backward compatibility)
async function performSearch() {
    const pId = document.getElementById('patient-id-search').value.trim();
    const resultArea = document.getElementById('patient-result-area');

    if (!pId) {
        showNotification("Please enter a valid Patient ID", 'warning');
        return;
    }

    // Fetch Patient Profile (all records are now public)
    const { data: patient, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', pId)
        .single();

    if (error) {
        showNotification("Patient not found. Double check the ID.", 'error');
        resultArea.classList.add('hidden');
        return;
    }

    // LOG ACCESS (Audit Log)
    await supabaseClient.from('audit_logs').insert([
        { doctor_id: currentDoctor.id, patient_id: pId, action: "Viewed Records & Profile" }
    ]);

    // DISPLAY DATA
    activePatientId = pId;
    document.getElementById('res-name').innerText = patient.name;
    document.getElementById('res-age').innerText = patient.age || 'N/A';
    document.getElementById('res-blood').innerText = patient.blood_group || 'N/A';
    document.getElementById('res-allergies').innerText = patient.allergies || 'None';
    document.getElementById('res-chronic').innerText = patient.chronic_illnesses || 'None';

    // Fetch Files
    const { data: files, error: filesError } = await supabaseClient.from('medical_records').select('*').eq('patient_id', pId);
    if (filesError) console.error('Error loading medical records:', filesError);

    const fileList = document.getElementById('res-files');
    fileList.innerHTML = (files || []).length ? files.map(f => `
        <li style="margin-bottom:10px;">
            📄 <a href="${f.file_url?.startsWith('data:') ? f.file_url : supabaseClient.storage.from('medical_records').getPublicUrl(f.file_url).data.publicUrl}" target="_blank">${f.file_name}</a>
        </li>
    `).join('') : '<li>No documents found.</li>';

    resultArea.classList.remove('hidden');
}

// PRESCRIPTION LOGIC
const prescriptionForm = document.getElementById('prescription-form');
if (prescriptionForm) {
    prescriptionForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!activePatientId) return;

        const medication = document.getElementById('presc-med').value;
        const dosage = document.getElementById('presc-dose').value;
        const duration = document.getElementById('presc-dur').value;
        const orderedTests = document.getElementById('presc-tests').value ? document.getElementById('presc-tests').value.split(',').map(s => s.trim()) : [];

        const { error } = await supabaseClient.from('prescriptions').insert([{
            doctor_id: currentDoctor.id,
            patient_id: activePatientId,
            medication_name: medication,
            dosage: dosage,
            course_duration: duration,
            ordered_tests: orderedTests
        }]);

        if (!error) {
            // Also log this action
            await supabaseClient.from('audit_logs').insert([
                { doctor_id: currentDoctor.id, patient_id: activePatientId, action: `Issued Prescription: ${medication}` }
            ]);
            showNotification("Prescription issued and logged.", "success");
            e.target.reset();
            loadDoctorHistory();
        } else {
            showNotification("Error issuing prescription: " + error.message, "error");
        }
    });
}

// TEST ORDERING LOGIC
const testForm = document.getElementById('test-form');
if (testForm) {
    testForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!activePatientId) return;

        const testName = document.getElementById('test-name').value;
        const dateOrdered = new Date().toISOString().split('T')[0];

        const { error } = await supabaseClient.from('tests').insert([{
            doctor_id: currentDoctor.id,
            patient_id: activePatientId,
            test_name: testName,
            date_ordered: dateOrdered
        }]);

        if (!error) {
            showNotification("Test ordered successfully.", "success");
            e.target.reset();
        } else {
            showNotification("Error ordering test: " + error.message, "error");
        }
    });
}

function formatDateDDMMYYYY(dateObj) {
    const d = String(dateObj.getDate()).padStart(2, '0');
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const y = dateObj.getFullYear();
    return `${d}/${m}/${y}`;
}

function formatTime24(dateObj) {
    const h = String(dateObj.getHours()).padStart(2, '0');
    const mm = String(dateObj.getMinutes()).padStart(2, '0');
    return `${h}:${mm}`;
}

// Check and update appointment status to expired if time has passed
async function checkAndUpdateExpiredAppointmentsDr(appointments) {
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
            console.error('Error loading slot end times for doctor expiry check:', slotError);
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

// Load Doctor Appointments
async function loadDoctorAppointments() {
    const today = new Date().toISOString().split('T')[0];
    const { data: appointments, error } = await supabaseClient
        .from('appointments')
        .select('*')
        .eq('doctor_id', currentDoctor.id)
        .gte('appointment_time', today + 'T00:00:00')
        .lt('appointment_time', today + 'T23:59:59')
        .order('appointment_time', { ascending: true });

    if (error) console.error('Error loading appointments:', error);
    
    // Check and update expired appointments
    const updatedAppointments = await checkAndUpdateExpiredAppointmentsDr(appointments);

    // Create patient name map
    const { data: patients } = await supabaseClient.from('profiles').select('id, name');
    const patientMap = {};
    patients?.forEach(p => patientMap[p.id] = p.name);

    const appointmentsList = document.getElementById('doctor-appointments-list');
    appointmentsList.innerHTML = (updatedAppointments || []).length ? updatedAppointments.map(apt => {
        const rawStatus = (apt.status || apt.appointment_status || 'scheduled');
        let statusValue = rawStatus ? rawStatus.toString().trim().toLowerCase() : 'scheduled';
        if (!statusValue) statusValue = 'scheduled';
        const allowedStatuses = ['scheduled', 'completed', 'pending', 'cancelled', 'expired'];
        const normalizedStatus = allowedStatuses.includes(statusValue) ? statusValue : 'unknown';
        const displayedStatus = (normalizedStatus.charAt(0).toUpperCase() + normalizedStatus.slice(1)) || 'Scheduled';
        console.debug('Appointment', apt.id, 'raw status', apt.status, 'appointment_status', apt.appointment_status, 'computed', statusValue, 'normalized', normalizedStatus, 'display', displayedStatus);
        const isCompleted = normalizedStatus === 'completed';
        const isExpired = normalizedStatus === 'expired';
        const cardStyle = isExpired
            ? "background: linear-gradient(135deg, #f5f5f5, #e5e5e5); border: 2px solid #999; padding: 20px; margin-bottom: 20px; border-radius: 12px; cursor: default; transition: all 0.3s ease; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1); position: relative; overflow: hidden; opacity: 0.7;"
            : isCompleted 
            ? "background: linear-gradient(135deg, #f0fdf4, #dcfce7); border: 2px solid var(--success); padding: 20px; margin-bottom: 20px; border-radius: 12px; cursor: default; transition: all 0.3s ease; box-shadow: 0 4px 15px rgba(42, 157, 143, 0.1); position: relative; overflow: hidden;"
            : "background: linear-gradient(135deg, #ffffff, #f8fbff); border: 2px solid var(--primary); padding: 20px; margin-bottom: 20px; border-radius: 12px; cursor: pointer; transition: all 0.3s ease; box-shadow: 0 4px 15px rgba(0, 119, 182, 0.1); position: relative; overflow: hidden;";
        const topBarStyle = isExpired
            ? "background: linear-gradient(90deg, #999, #666);"
            : isCompleted
            ? "background: linear-gradient(90deg, var(--success), #52c41a);"
            : "background: linear-gradient(90deg, var(--primary), var(--secondary));";
        const statusStyle = isExpired
            ? "background: linear-gradient(135deg, #dc2626, #991b1b);"
            : isCompleted
            ? "background: linear-gradient(135deg, var(--success), #52c41a);"
            : normalizedStatus === 'scheduled'
                ? "background: linear-gradient(135deg, var(--primary), #38bdf8);"
                : normalizedStatus === 'pending'
                    ? "background: linear-gradient(135deg, var(--warning), #f59e0b);"
                    : normalizedStatus === 'cancelled'
                        ? "background: linear-gradient(135deg, var(--danger), #dc2626);"
                        : "background: linear-gradient(135deg, #64748b, #334155);";
        const clickAction = (isCompleted || isExpired) ? "" : `onclick="openPatientConsultation('${apt.patient_id}', '${apt.id}')"`;
        const isConsultationAllowed = !isCompleted && !isExpired && normalizedStatus === 'scheduled';
        return `
        <div class="appointment-item ${isConsultationAllowed ? 'clickable-card' : ''}" ${clickAction} style="${cardStyle}">
            <div style="position: absolute; top: 0; left: 0; width: 100%; height: 4px; ${topBarStyle}"></div>
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div style="flex: 1;">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                        <i class="fas fa-calendar-check" style="color: ${isCompleted ? 'var(--success)' : 'var(--primary)'}; font-size: 1.2em;"></i>
                        <strong style="font-size: 1.2em; color: var(--primary-dark);">${formatDateDDMMYYYY(new Date(apt.appointment_time))} ${formatTime24(new Date(apt.appointment_time))}</strong>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                        <i class="fas fa-user-injured" style="color: var(--text-muted);"></i>
                        <p style="margin: 0; color: var(--text-main); font-weight: 500;">${patientMap[apt.patient_id] || 'Patient'}</p>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <i class="fas fa-info-circle" style="color: var(--text-muted);"></i>
                        <p style="margin: 0; color: var(--text-main);">Status:
                            <span class="status-badge" style="background: ${statusStyle};" data-status="${normalizedStatus}">${displayedStatus || 'Scheduled'}</span>
                        </p>
                    </div>
                </div>
                <div style="display: flex; gap: 10px; flex-direction: column;">
                    <button onclick="event.stopPropagation(); viewPatientDetails('${apt.patient_id}')" class="btn-secondary" style="font-size: 0.85rem; padding: 8px 12px; border-radius: 20px; display: flex; align-items: center; gap: 6px;" title="View Patient Details">
                        <i class="fas fa-user-md"></i> Details
                    </button>
                    <button onclick="event.stopPropagation(); viewPatientRecords('${apt.patient_id}')" class="btn-primary" style="font-size: 0.85rem; padding: 8px 12px; border-radius: 20px; display: flex; align-items: center; gap: 6px;" title="View Medical Records">
                        <i class="fas fa-folder-open"></i> Records
                    </button>
                </div>
            </div>
            ${isCompleted ? `
            <div style="margin-top: 15px; padding: 10px; background: rgba(42, 157, 143, 0.1); border-radius: 8px; border: 1px solid rgba(42, 157, 143, 0.2);">
                <div style="display: flex; align-items: center; gap: 8px; font-size: 0.9em; color: var(--success); font-weight: 500;">
                    <i class="fas fa-check-circle"></i>
                    <span>Consultation Completed</span>
                </div>
            </div>
            ` : isExpired ? `
            <div style="margin-top: 15px; padding: 10px; background: rgba(220, 38, 38, 0.05); border-radius: 8px; border: 1px solid rgba(220, 38, 38, 0.1);">
                <div style="display: flex; align-items: center; gap: 8px; font-size: 0.9em; color: #dc2626; font-weight: 500;">
                    <i class="fas fa-exclamation-circle"></i>
                    <span>Appointment Expired</span>
                </div>
            </div>
            ` : `
            <div style="margin-top: 15px; padding: 10px; background: rgba(0, 119, 182, 0.05); border-radius: 8px; border: 1px solid rgba(0, 119, 182, 0.1);">
                <div style="display: flex; align-items: center; gap: 8px; font-size: 0.9em; color: var(--primary); font-weight: 500;">
                    <i class="fas fa-hand-pointer"></i>
                    <span>Click anywhere to start consultation</span>
                    <i class="fas fa-arrow-right"></i>
                </div>
            </div>
            `}
        </div>
    `}).join('') : `
        <div style="text-align: center; padding: 60px 20px; background: linear-gradient(135deg, #f8fbff, #e0f2fe); border-radius: 15px; border: 2px dashed var(--primary);">
            <i class="fas fa-calendar-times" style="font-size: 4em; color: var(--text-muted); margin-bottom: 20px;"></i>
            <h3 style="color: var(--text-main); margin-bottom: 10px;">No Appointments Today</h3>
            <p style="color: var(--text-muted); font-size: 1.1rem;">You have no scheduled appointments for today. Check back later or contact reception.</p>
        </div>
    `;
}



// View Patient Details
async function viewPatientDetails(patientId) {
    // Fetch patient profile
    const { data: patient, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', patientId)
        .single();

    if (error) {
        showNotification("Error loading patient details: " + error.message, "error");
        return;
    }

    // Log access
    await supabaseClient.from('audit_logs').insert([
        { doctor_id: currentDoctor.id, patient_id: patientId, action: "Viewed Patient Details" }
    ]);

    // Show details in modal
    showPatientDetailsModal(patient);
}

// View Patient Medical Records
async function viewPatientRecords(patientId) {
    // Fetch medical records
    const { data: records, error } = await supabaseClient
        .from('medical_records')
        .select('*')
        .eq('patient_id', patientId)
        .order('upload_date', { ascending: false });

    if (error) {
        showNotification("Error loading medical records: " + error.message, "error");
        return;
    }

    // Log access
    await supabaseClient.from('audit_logs').insert([
        { doctor_id: currentDoctor.id, patient_id: patientId, action: "Viewed Medical Records" }
    ]);

    // Show records in modal (pass records even if empty)
    showPatientRecordsModal(records || [], patientId);
}

// Modal for Patient Details
function showPatientDetailsModal(patient) {
    const modal = document.createElement('div');
    modal.className = 'patient-modal';
    modal.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 2000; display: flex; align-items: center; justify-content: center;">
            <div style="background: white; padding: 25px; border-radius: 12px; max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 2px solid var(--primary); padding-bottom: 15px;">
                    <h2 style="margin: 0; color: var(--primary-dark);"><i class="fas fa-user-md"></i> Patient Details</h2>
                    <button onclick="this.closest('.patient-modal').remove()" style="background: none; border: none; font-size: 1.5em; cursor: pointer; color: var(--text-muted);">&times;</button>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                    <div style="background: #f8f9fa; padding: 15px; border-radius: 8px;">
                        <h4 style="margin: 0 0 10px 0; color: var(--primary);"><i class="fas fa-id-card"></i> Basic Information</h4>
                        <p><strong>Name:</strong> ${patient.name || 'N/A'}</p>
                        <p><strong>Age:</strong> ${patient.age || 'N/A'}</p>
                        <p><strong>Gender:</strong> ${patient.gender || 'N/A'}</p>
                        <p><strong>Blood Group:</strong> ${patient.blood_group || 'N/A'}</p>
                    </div>

                    <div style="background: #f8f9fa; padding: 15px; border-radius: 8px;">
                        <h4 style="margin: 0 0 10px 0; color: var(--primary);"><i class="fas fa-heartbeat"></i> Medical Information</h4>
                        <p><strong>Chronic Illnesses:</strong> ${Array.isArray(patient.chronic_illnesses) ? patient.chronic_illnesses.join(', ') : (patient.chronic_illnesses || 'None')}</p>
                        <p><strong>Allergies:</strong> ${Array.isArray(patient.allergies) ? patient.allergies.join(', ') : (patient.allergies || 'None')}</p>
                        <p><strong>Current Medications:</strong> ${Array.isArray(patient.current_medications) ? patient.current_medications.join(', ') : (patient.current_medications || 'None')}</p>
                    </div>
                </div>

                <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-top: 15px;">
                    <h4 style="margin: 0 0 10px 0; color: var(--primary);"><i class="fas fa-phone"></i> Contact Information</h4>
                    <p><strong>Emergency Contact:</strong> ${patient.emergency_contact || 'N/A'}</p>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
}

// Modal for Patient Records
function showPatientRecordsModal(records, patientId) {
    const modal = document.createElement('div');
    modal.className = 'patient-modal';
    modal.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 2000; display: flex; align-items: center; justify-content: center;">
            <div style="background: white; padding: 25px; border-radius: 12px; max-width: 700px; width: 90%; max-height: 80vh; overflow-y: auto; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 2px solid var(--primary); padding-bottom: 15px;">
                    <h2 style="margin: 0; color: var(--primary-dark);"><i class="fas fa-folder-open"></i> Medical Records</h2>
                    <button onclick="this.closest('.patient-modal').remove()" style="background: none; border: none; font-size: 1.5em; cursor: pointer; color: var(--text-muted);">&times;</button>
                </div>

                ${records && records.length > 0 ? `
                    <div style="space-y: 10px;">
                        ${records.map(record => `
                            <div style="border: 1px solid var(--border); padding: 15px; border-radius: 8px; margin-bottom: 10px; background: #f8f9fa;">
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <div>
                                        <h4 style="margin: 0 0 5px 0; color: var(--primary);"><i class="fas fa-file-pdf"></i> ${record.file_name}</h4>
                                        <p style="margin: 0; color: var(--text-muted); font-size: 0.9em;">Uploaded: ${formatDateDDMMYYYY(new Date(record.upload_date))}</p>
                                    </div>
                                    <button onclick="downloadPatientRecord('${record.file_url}', '${record.file_name}')"
                                            class="btn-primary"
                                            style="font-size: 0.85rem; padding: 6px 12px; border: none; cursor: pointer;">
                                        <i class="fas fa-download"></i> Download
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                ` : `
                    <div style="text-align: center; padding: 40px; color: var(--text-muted);">
                        <i class="fas fa-folder-open" style="font-size: 3em; margin-bottom: 15px;"></i>
                        <h3>No Medical Records Found</h3>
                        <p>This patient hasn't uploaded any medical records yet.</p>
                    </div>
                `}
            </div>
        </div>
    `;

    document.body.appendChild(modal);
}

// Download Patient Record
async function downloadPatientRecord(fileUrl, fileName) {
    try {
        if (typeof fileUrl === 'string' && fileUrl.startsWith('data:')) {
            const a = document.createElement('a');
            a.href = fileUrl;
            a.download = fileName || 'MediVault_Prescription.pdf';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            showNotification("File downloaded successfully!", "success");
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

        // Create a download link
        const url = URL.createObjectURL(data);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showNotification("File downloaded successfully!", "success");
    } catch (error) {
        console.error('Download error:', error);
        showNotification("Failed to download file. Please try again.", "error");
    }
}

// Open Patient Consultation Modal
async function openPatientConsultation(patientId, appointmentId) {
    // Fetch patient details
    const { data: patient, error: patientError } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', patientId)
        .single();

    if (patientError) {
        showNotification("Error loading patient details: " + patientError.message, "error");
        return;
    }

    // Check privacy settings
    if (patient.record_visibility !== 'public') {
        showNotification("Cannot access patient records - privacy settings restrict access.", "error");
        return;
    }

    // Check if there's already an active consultation
    if (activeConsultation) {
        showNotification("Please complete or close the current consultation before starting a new one.", "warning");
        return;
    }

    // Log consultation start
    await supabaseClient.from('audit_logs').insert([
        { doctor_id: currentDoctor.id, patient_id: patientId, action: "Started Consultation" }
    ]);

    // Create consultation modal
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content consultation-modal" style="max-width: 900px; max-height: 95vh; overflow-y: auto; border-radius: 15px; box-shadow: 0 20px 40px rgba(0,0,0,0.3);">
            <div class="modal-header" style="background: linear-gradient(135deg, var(--primary), var(--primary-dark)); color: white; padding: 20px 25px; border-radius: 15px 15px 0 0;">
                <h2 style="margin: 0; display: flex; align-items: center; gap: 10px;"><i class="fas fa-user-md"></i> Patient Consultation</h2>
                <button onclick="closeConsultation()" class="close-btn" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 35px; height: 35px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.3s ease;" title="Close consultation (changes will not be saved)">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body">
                <div class="patient-summary" style="background: var(--background-light); padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                    <h3>${patient.name}</h3>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-top: 10px;">
                        <p><strong>Age:</strong> ${patient.age || 'N/A'}</p>
                        <p><strong>Gender:</strong> ${patient.gender || 'N/A'}</p>
                        <p><strong>Blood Group:</strong> ${patient.blood_group || 'N/A'}</p>
                        <p><strong>Allergies:</strong> ${Array.isArray(patient.allergies) ? patient.allergies.join(', ') : (patient.allergies || 'None')}</p>
                        <p><strong>Chronic Illnesses:</strong> ${Array.isArray(patient.chronic_illnesses) ? patient.chronic_illnesses.join(', ') : (patient.chronic_illnesses || 'None')}</p>
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 25px; justify-content: center; align-items: start;">
                    <!-- Prescription Section -->
                    <div class="consultation-section" style="background: linear-gradient(135deg, #f0f9ff, #e0f2fe); padding: 20px; border-radius: 12px; border: 2px solid var(--primary); max-width: 700px; margin: 0 auto;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                            <h4 style="margin: 0; color: var(--primary-dark); display: flex; align-items: center; gap: 8px;">
                                <i class="fas fa-pills"></i> Prescribe Medications
                            </h4>
                            <button type="button" onclick="addMedication()" class="btn-secondary" style="font-size: 0.9rem; padding: 8px 16px; border-radius: 20px;" title="Add another medication">
                                <i class="fas fa-plus-circle"></i> Add Medication
                            </button>
                        </div>
                        <form id="consultation-prescription-form">
                            <div id="medications-container">
                                <div class="medication-entry" style="background: white; border: 2px solid var(--primary); padding: 20px; border-radius: 12px; margin-bottom: 20px; box-shadow: 0 4px 12px rgba(0, 119, 182, 0.1);">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                                        <h5 style="margin: 0; color: var(--primary-dark); display: flex; align-items: center; gap: 8px;">
                                            <i class="fas fa-prescription-bottle"></i> Medication 1
                                        </h5>
                                        <button type="button" onclick="removeMedication(this)" class="btn-danger" style="font-size: 0.8rem; padding: 6px 12px; border-radius: 15px;" title="Remove medication">
                                            <i class="fas fa-trash-alt"></i> Remove
                                        </button>
                                    </div>
                                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
                                        <input type="text" class="med-name" placeholder="Medication Name" required style="width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: 6px; font-size: 0.9rem;">
                                        <input type="text" class="med-dose" placeholder="Dosage (e.g. 1-0-1)" required style="width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: 6px; font-size: 0.9rem;">
                                    </div>
                                    <input type="text" class="med-dur" placeholder="Duration (e.g. 7 Days)" required style="width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: 6px; font-size: 0.9rem;">
                                </div>
                            </div>
                            <button type="submit" class="btn-primary" style="width: 100%;">Issue Prescriptions</button>
                        </form>
                    </div>

                    <!-- Test Ordering Section -->
                    <div class="consultation-section" style="background: linear-gradient(135deg, #e8f4ff, #d4eaff); padding: 20px; border-radius: 12px; border: 2px solid var(--primary);">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                            <h4 style="margin: 0; color: var(--primary-dark); display: flex; align-items: center; gap: 8px;">
                                <i class="fas fa-flask"></i> Order Lab Tests
                            </h4>
                            <button type="button" onclick="addTest()" class="btn-secondary" style="font-size: 0.9rem; padding: 8px 16px; border-radius: 20px;" title="Add another test">
                                <i class="fas fa-plus-circle"></i> Add Test
                            </button>
                        </div>
                        <form id="consultation-test-form">
                            <div id="tests-container">
                                <div class="test-entry" style="background: white; border: 2px solid var(--accent); padding: 20px; border-radius: 12px; margin-bottom: 20px; box-shadow: 0 4px 12px rgba(245, 158, 11, 0.1);">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                                        <h5 style="margin: 0; color: #92400e; display: flex; align-items: center; gap: 8px;">
                                            <i class="fas fa-vial"></i> Test 1
                                        </h5>
                                        <button type="button" onclick="removeTest(this)" class="btn-danger" style="font-size: 0.8rem; padding: 6px 12px; border-radius: 15px;" title="Remove test">
                                            <i class="fas fa-trash-alt"></i> Remove
                                        </button>
                                    </div>
                                    <input type="text" class="test-name" placeholder="Test Name (e.g. Blood Test, X-Ray)" required style="width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: 6px; font-size: 0.9rem;">
                                </div>
                            </div>
                            <button type="submit" class="btn-primary" style="width: 100%;">Order Tests</button>
                        </form>
                    </div>
                </div>

                <!-- Quick Actions -->
                <div class="consultation-section" style="margin-top: 25px; background: linear-gradient(135deg, #f0f9ff, #e0f2fe); padding: 20px; border-radius: 12px; border: 2px solid var(--primary); max-width: 780px; margin: 0 auto;">
                    <h4 style="margin: 0 0 15px 0; color: var(--primary-dark); display: flex; align-items: center; gap: 8px;">
                        <i class="fas fa-bolt"></i> Quick Actions
                    </h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
                        <button onclick="viewPatientDetails('${patientId}')" class="btn-secondary" style="display: flex; align-items: center; justify-content: center; gap: 8px; padding: 12px;">
                            <i class="fas fa-user-md"></i> View Full Details
                        </button>
                        <button onclick="viewPatientRecords('${patientId}')" class="btn-primary" style="display: flex; align-items: center; justify-content: center; gap: 8px; padding: 12px;">
                            <i class="fas fa-folder-open"></i> View Medical Records
                        </button>
                        <button onclick="completeAppointment('${appointmentId}', '${patientId}')" class="btn-success" style="display: flex; align-items: center; justify-content: center; gap: 8px; padding: 12px;">
                            <i class="fas fa-check-circle"></i> Complete Consultation
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Set active consultation
    activeConsultation = {
        patientId: patientId,
        appointmentId: appointmentId,
        modal: modal,
        patientName: patient.name,
        patientDetails: patient,
        doctorName: currentDoctor.user_metadata?.name || 'Doctor',
        appointmentTime: new Date().toISOString(), // Use current time as consultation start time
        prescriptions: [],
        tests: []
    };

    document.body.appendChild(modal);
    updateActiveConsultationDisplay();

    // Handle prescription form submission
    document.getElementById('consultation-prescription-form').addEventListener('submit', async (e) => {
        e.preventDefault();

        const medicationEntries = document.querySelectorAll('.medication-entry');
        const prescriptions = [];

        for (const entry of medicationEntries) {
            const medication = entry.querySelector('.med-name').value.trim();
            const dosage = entry.querySelector('.med-dose').value.trim();
            const duration = entry.querySelector('.med-dur').value.trim();

            if (medication && dosage && duration) {
                prescriptions.push({
                    doctor_id: currentDoctor.id,
                    patient_id: patientId,
                    medication_name: medication,
                    dosage: dosage,
                    course_duration: duration,
                    ordered_tests: null
                });
            }
        }

        if (prescriptions.length === 0) {
            showNotification("Please add at least one medication.", "warning");
            return;
        }

        const { error } = await supabaseClient.from('prescriptions').insert(prescriptions);

        if (error) {
            showNotification("Error issuing prescriptions: " + error.message, "error");
        } else {
            if (activeConsultation) {
                activeConsultation.prescriptions = [
                    ...(activeConsultation.prescriptions || []),
                    ...cloneConsultationItems(prescriptions)
                ];
            }

            // Log prescriptions
            for (const presc of prescriptions) {
                await supabaseClient.from('audit_logs').insert([
                    { doctor_id: currentDoctor.id, patient_id: patientId, action: `Prescribed: ${presc.medication_name}` }
                ]);
            }

            showNotification(`${prescriptions.length} prescription(s) issued successfully!`, "success");

            // Reset form
            document.getElementById('medications-container').innerHTML = `
                <div class="medication-entry" style="border: 1px solid var(--border); padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <h5 style="margin: 0;">Medication 1</h5>
                        <button type="button" onclick="removeMedication(this)" class="btn-danger" style="font-size: 0.8rem; padding: 4px 8px;" title="Remove medication">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                    <input type="text" class="med-name" placeholder="Medication Name" required style="width: 100%; margin-bottom: 8px; padding: 8px;">
                    <input type="text" class="med-dose" placeholder="Dosage (e.g. 1-0-1)" required style="width: 100%; margin-bottom: 8px; padding: 8px;">
                    <input type="text" class="med-dur" placeholder="Duration (e.g. 7 Days)" required style="width: 100%; padding: 8px;">
                </div>
            `;

            loadDoctorHistory(); // Refresh history
        }
    });

    // Handle test form submission
    document.getElementById('consultation-test-form').addEventListener('submit', async (e) => {
        e.preventDefault();

        const testEntries = document.querySelectorAll('.test-entry');
        const tests = [];

        for (const entry of testEntries) {
            const testName = entry.querySelector('.test-name').value.trim();

            if (testName) {
                tests.push({
                    doctor_id: currentDoctor.id,
                    patient_id: patientId,
                    test_name: testName,
                    date_ordered: new Date().toISOString().split('T')[0]
                });
            }
        }

        if (tests.length === 0) {
            showNotification("Please add at least one test.", "warning");
            return;
        }

        const { error } = await supabaseClient.from('tests').insert(tests);

        if (error) {
            showNotification("Error ordering tests: " + error.message, "error");
        } else {
            if (activeConsultation) {
                activeConsultation.tests = [
                    ...(activeConsultation.tests || []),
                    ...cloneConsultationItems(tests)
                ];
            }

            // Log tests
            for (const test of tests) {
                await supabaseClient.from('audit_logs').insert([
                    { doctor_id: currentDoctor.id, patient_id: patientId, action: `Ordered Test: ${test.test_name}` }
                ]);
            }

            showNotification(`${tests.length} test(s) ordered successfully!`, "success");

            // Reset form
            document.getElementById('tests-container').innerHTML = `
                <div class="test-entry" style="border: 1px solid var(--border); padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <h5 style="margin: 0;">Test 1</h5>
                        <button type="button" onclick="removeTest(this)" class="btn-danger" style="font-size: 0.8rem; padding: 4px 8px;" title="Remove test">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                    <input type="text" class="test-name" placeholder="Test Name" required style="width: 100%; padding: 8px;">
                </div>
            `;
        }
    });
}

// Complete Appointment
async function completeAppointment(appointmentId, patientId) {
    console.log('completeAppointment called with:', appointmentId, patientId);
    console.log('appointmentId type:', typeof appointmentId, 'value:', appointmentId);
    console.log('currentDoctor:', currentDoctor?.id);

    if (!appointmentId || !patientId) {
        showNotification("Invalid appointment or patient ID", "error");
        console.error('Missing appointmentId or patientId');
        return;
    }

    // First, let's verify the appointment exists and belongs to this doctor
    const { data: appointment, error: fetchError } = await supabaseClient
        .from('appointments')
        .select('*')
        .eq('id', appointmentId)
        .eq('doctor_id', currentDoctor.id)
        .single();

    console.log('Appointment data:', appointment, 'Error:', fetchError);

    if (fetchError) {
        showNotification("Error fetching appointment: " + fetchError.message, "error");
        console.error('Fetch error:', fetchError);
        return;
    }

    if (!appointment) {
        showNotification("Appointment not found or access denied", "error");
        console.error('Appointment not found');
        return;
    }

    console.log('Current appointment status:', appointment.status);

    // Now update the status
    const { data: updateResult, error } = await supabaseClient
        .from('appointments')
        .update({ status: 'completed' })
        .eq('id', appointmentId)
        .eq('doctor_id', currentDoctor.id)
        .select();

    console.log('Update result:', updateResult, 'Update error:', error);

    if (error) {
        showNotification("Error completing appointment: " + error.message, "error");
        console.error('Update error:', error);
        console.error('Error details:', JSON.stringify(error, null, 2));
    } else {
        console.log('Appointment successfully updated to completed');
        console.log('Updated appointment:', updateResult);

        const consultationSnapshot = activeConsultation ? {
            patientId: activeConsultation.patientId,
            appointmentId: activeConsultation.appointmentId,
            patientName: activeConsultation.patientName,
            patientDetails: activeConsultation.patientDetails,
            doctorName: activeConsultation.doctorName,
            prescriptions: cloneConsultationItems(activeConsultation.prescriptions),
            tests: cloneConsultationItems(activeConsultation.tests),
            completedAt: new Date()
        } : null;

        if (consultationSnapshot) {
            await generateMedicalPDF(consultationSnapshot);
        }

        // Show success notification
        showNotification("Consultation completed successfully!", "success");

        // Log completion
        const { error: logError } = await supabaseClient.from('audit_logs').insert([
            { doctor_id: currentDoctor.id, patient_id: patientId, action: "Completed Consultation" }
        ]);

        if (logError) {
            console.error('Error logging completion:', logError);
        }

        activeConsultation = null;
        updateActiveConsultationDisplay();
        document.querySelector('.consultation-modal')?.closest('.modal-overlay')?.remove();
    }
}

// Add Medication Entry
function addMedication() {
    const container = document.getElementById('medications-container');
    const medicationCount = container.querySelectorAll('.medication-entry').length + 1;

    const medicationEntry = document.createElement('div');
    medicationEntry.className = 'medication-entry';
    medicationEntry.style.cssText = 'border: 1px solid var(--border); padding: 15px; border-radius: 8px; margin-bottom: 15px;';

    medicationEntry.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <h5 style="margin: 0;">Medication ${medicationCount}</h5>
            <button type="button" onclick="removeMedication(this)" class="btn-danger" style="font-size: 0.8rem; padding: 4px 8px;" title="Remove medication">
                <i class="fas fa-trash"></i>
            </button>
        </div>
        <input type="text" class="med-name" placeholder="Medication Name" required style="width: 100%; margin-bottom: 8px; padding: 8px;">
        <input type="text" class="med-dose" placeholder="Dosage (e.g. 1-0-1)" required style="width: 100%; margin-bottom: 8px; padding: 8px;">
        <input type="text" class="med-dur" placeholder="Duration (e.g. 7 Days)" required style="width: 100%; padding: 8px;">
    `;

    container.appendChild(medicationEntry);
}

// Remove Medication Entry
function removeMedication(button) {
    const container = document.getElementById('medications-container');
    const entries = container.querySelectorAll('.medication-entry');

    if (entries.length > 1) {
        button.closest('.medication-entry').remove();

        // Renumber remaining entries
        entries.forEach((entry, index) => {
            if (entry.parentNode) { // Check if not removed
                const header = entry.querySelector('h5');
                if (header) header.textContent = `Medication ${index + 1}`;
            }
        });
    } else {
        showNotification("At least one medication is required.", "warning");
    }
}

// Add Test Entry
function addTest() {
    const container = document.getElementById('tests-container');
    const testCount = container.querySelectorAll('.test-entry').length + 1;

    const testEntry = document.createElement('div');
    testEntry.className = 'test-entry';
    testEntry.style.cssText = 'border: 1px solid var(--border); padding: 15px; border-radius: 8px; margin-bottom: 15px;';

    testEntry.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <h5 style="margin: 0;">Test ${testCount}</h5>
            <button type="button" onclick="removeTest(this)" class="btn-danger" style="font-size: 0.8rem; padding: 4px 8px;" title="Remove test">
                <i class="fas fa-trash"></i>
            </button>
        </div>
        <input type="text" class="test-name" placeholder="Test Name" required style="width: 100%; padding: 8px;">
    `;

    container.appendChild(testEntry);
}

// Remove Test Entry
function removeTest(button) {
    const container = document.getElementById('tests-container');
    const entries = container.querySelectorAll('.test-entry');

    if (entries.length > 1) {
        button.closest('.test-entry').remove();

        // Renumber remaining entries
        entries.forEach((entry, index) => {
            if (entry.parentNode) { // Check if not removed
                const header = entry.querySelector('h5');
                if (header) header.textContent = `Test ${index + 1}`;
            }
        });
    } else {
        showNotification("At least one test is required.", "warning");
    }
}

async function loadDoctorHistory() {
    const { data, error } = await supabaseClient
        .from('prescriptions')
        .select('*, profiles!patient_id(name)')
        .eq('doctor_id', currentDoctor.id);

    if (error) console.error('Error loading doctor history:', error);

    const tbody = document.querySelector('#doc-presc-table tbody');
    tbody.innerHTML = (data || []).map(p => `
        <tr>
            <td>${p.profiles?.name || 'Unknown'}</td>
            <td>${p.medication_name}</td>
            <td>${formatDateDDMMYYYY(new Date(p.date_prescribed))}</td>
        </tr>
    `).join('');
}

/**
 * Show custom confirmation modal
 */
function showConfirmationModal(message, onConfirm, onCancel = null) {
    // Remove any existing confirmation modal
    const existingModal = document.querySelector('.confirmation-modal');
    if (existingModal) {
        existingModal.remove();
    }

    const modal = document.createElement('div');
    modal.className = 'confirmation-modal';
    modal.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 3000; display: flex; align-items: center; justify-content: center;">
            <div style="background: white; padding: 25px; border-radius: 12px; max-width: 400px; width: 90%; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
                <div style="text-align: center; margin-bottom: 20px;">
                    <div style="font-size: 3em; margin-bottom: 15px;">⚠️</div>
                    <h3 style="margin: 0 0 10px 0; color: var(--text-dark);">Confirm Action</h3>
                    <p style="margin: 0; color: var(--text-muted); line-height: 1.5;">${message}</p>
                </div>
                <div style="display: flex; gap: 10px; justify-content: center;">
                    <button id="confirm-cancel-btn" class="btn-secondary" style="flex: 1;">
                        <i class="fas fa-times"></i> Cancel
                    </button>
                    <button id="confirm-ok-btn" class="btn-danger" style="flex: 1;">
                        <i class="fas fa-check"></i> Confirm
                    </button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Add event listeners for the buttons
    document.getElementById('confirm-cancel-btn').addEventListener('click', () => {
        modal.remove();
        if (onCancel) onCancel();
    });

    document.getElementById('confirm-ok-btn').addEventListener('click', () => {
        modal.remove();
        onConfirm();
    });
}

/**
 * Close active consultation with confirmation
 */
function closeConsultation() {
    if (activeConsultation) {
        showConfirmationModal(
            "Are you sure you want to close this consultation? All unsaved changes will be lost.",
            () => {
                activeConsultation.modal.remove();
                activeConsultation = null;
                updateActiveConsultationDisplay();
                showNotification("Consultation closed without saving.", "warning");
            }
        );
    }
}

/**
 * Update the active consultation display in the home tab
 */
function updateActiveConsultationDisplay() {
    const section = document.getElementById('active-consultation-section');
    const content = document.getElementById('active-consultation-content');

    if (activeConsultation) {
        section.style.display = 'block';
        content.innerHTML = `
            <div class="consultation-info-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
                <div class="info-card" style="background: var(--background-light); padding: 15px; border-radius: 8px; border-left: 4px solid var(--primary);">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                        <i class="fas fa-user" style="color: var(--primary); font-size: 1.2em;"></i>
                        <h4 style="margin: 0; color: var(--primary);">Patient</h4>
                    </div>
                    <p style="margin: 0; font-weight: 500; color: var(--text-dark);">${activeConsultation.patientName || 'Loading...'}</p>
                </div>
                <div class="info-card" style="background: var(--background-light); padding: 15px; border-radius: 8px; border-left: 4px solid var(--success);">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                        <i class="fas fa-clock" style="color: var(--success); font-size: 1.2em;"></i>
                        <h4 style="margin: 0; color: var(--success);">Started</h4>
                    </div>
                    <p style="margin: 0; font-weight: 500; color: var(--text-dark);">${formatDateDDMMYYYY(new Date(activeConsultation.appointmentTime))} ${new Date(activeConsultation.appointmentTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
            </div>
            <div class="consultation-actions" style="display: flex; gap: 10px; flex-wrap: wrap;">
                <button onclick="focusConsultationModal()" class="btn-primary" style="flex: 1; min-width: 150px; display: flex; align-items: center; justify-content: center; gap: 8px;">
                    <i class="fas fa-arrow-up"></i>
                    <span>Continue Consultation</span>
                </button>
                <button onclick="closeConsultation()" class="btn-danger" style="flex: 1; min-width: 150px; display: flex; align-items: center; justify-content: center; gap: 8px;">
                    <i class="fas fa-times-circle"></i>
                    <span>Close Consultation</span>
                </button>
            </div>
        `;
    } else {
        section.style.display = 'none';
        content.innerHTML = '';
    }
}

/**
 * Focus on the consultation modal
 */
function focusConsultationModal() {
    if (activeConsultation && activeConsultation.modal) {
        activeConsultation.modal.scrollIntoView({ behavior: 'smooth' });
    }
}
