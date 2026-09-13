import ConfirmDialog from './ui/ConfirmDialog'
import { useFocusView } from './focus/useFocusView'
import FocusStyles from './focus/FocusStyles'
import FocusSetup from './focus/FocusSetup'
import FocusActive from './focus/FocusActive'
import FocusRetro from './focus/FocusRetro'

export default function FocusView() {
  const focusView = useFocusView()
  const {
    step, focusExitToSetup, setRetroNotes, setRetroTasks, showCancelConfirm, setShowCancelConfirm,
    showDiscardConfirm, setShowDiscardConfirm, loadFocusData, performCancelSession
  } = focusView

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        padding: 'var(--space-6)',
        overflowY: 'auto',
        background: 'var(--color-background)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-6)'
      }}
    >
      <FocusStyles />

      {/* STEP 1: SETUP SCREEN */}
      {step === 'setup' && (
        <FocusSetup focusView={focusView} />
      )}

      {/* STEP 2: ACTIVE SESSION SCREEN */}
      {step === 'active' && (
        <FocusActive focusView={focusView} />
      )}

      {/* STEP 3: RETROSPECTIVE SCREEN */}
      {step === 'retro' && (
        <FocusRetro focusView={focusView} />
      )}
        <ConfirmDialog
          isOpen={showCancelConfirm}
          title="Cancel Session"
          message="Cancel this focus session? No progress will be saved."
          confirmText="Yes, Cancel"
          isDestructive
          onConfirm={performCancelSession}
          onCancel={() => setShowCancelConfirm(false)}
        />

        <ConfirmDialog
          isOpen={showDiscardConfirm}
          title="Discard Retrospective"
          message="Discard session statistics and notes?"
          confirmText="Yes, Discard"
          isDestructive
          onConfirm={() => {
            setShowDiscardConfirm(false)
            setRetroNotes('')
            setRetroTasks([])
            focusExitToSetup()
            loadFocusData()
          }}
          onCancel={() => setShowDiscardConfirm(false)}
        />
    </div>
  )
}