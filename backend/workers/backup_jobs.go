package workers

import (
	"fmt"
	"sync"
	"time"

	"github.com/hendrax5/noap/models"
)

// BackupJobStatus represents the lifecycle of an async backup job.
type BackupJobStatus string

const (
	JobRunning   BackupJobStatus = "running"
	JobCompleted BackupJobStatus = "completed"
	JobFailed    BackupJobStatus = "failed"
)

// BackupJob tracks the state of an in-flight async backup.
type BackupJob struct {
	DeviceID  uint            `json:"device_id"`
	Status    BackupJobStatus `json:"status"`
	Changed   bool            `json:"changed"`
	BackupID  uint            `json:"backup_id,omitempty"`
	Error     string          `json:"error,omitempty"`
	StartedAt time.Time       `json:"started_at"`
	DoneAt    *time.Time      `json:"done_at,omitempty"`
}

var (
	backupJobs   = make(map[uint]*BackupJob) // key = deviceID
	backupJobsMu sync.RWMutex
)

// StartBackupJob launches BackupDeviceNow in a goroutine and tracks the result.
// Returns immediately so the HTTP handler can respond with 202.
// Only one job per device at a time; returns an error if already running.
func StartBackupJob(dev models.Device) (*BackupJob, error) {
	backupJobsMu.Lock()
	if existing, ok := backupJobs[dev.ID]; ok && existing.Status == JobRunning {
		backupJobsMu.Unlock()
		return existing, fmt.Errorf("backup already in progress for device %d", dev.ID)
	}
	job := &BackupJob{
		DeviceID:  dev.ID,
		Status:    JobRunning,
		StartedAt: time.Now(),
	}
	backupJobs[dev.ID] = job
	backupJobsMu.Unlock()

	go func() {
		result := BackupDeviceNow(dev)
		now := time.Now()

		backupJobsMu.Lock()
		defer backupJobsMu.Unlock()

		job.DoneAt = &now
		if result.Err != nil {
			job.Status = JobFailed
			job.Error = result.Err.Error()
		} else {
			job.Status = JobCompleted
			job.Changed = result.Changed
			job.BackupID = result.BackupID
		}
	}()

	return job, nil
}

// GetBackupJob returns the current/latest job for a device, or nil.
func GetBackupJob(deviceID uint) *BackupJob {
	backupJobsMu.RLock()
	defer backupJobsMu.RUnlock()
	return backupJobs[deviceID]
}
