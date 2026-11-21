<?php

declare(strict_types=1);

namespace Lecteur\Application\Message\Command\ArchiverLecteur;

use Common\Domain\Adapter\MailerInterface;
use Lecteur\Domain\Exception\PretsEnCoursException;
use Lecteur\Domain\Model\Lecteur;
use Lecteur\Domain\Notification\ArchivageEmail;
use Lecteur\Domain\Repository\LecteurRepositoryInterface;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;

#[AsMessageHandler(bus: 'command.bus')]
final readonly class ArchiverLecteurHandler
{
    public function __construct(
        private LecteurRepositoryInterface $lecteurRepository,
        private MailerInterface $mailer,
    ) {
    }

    public function __invoke(ArchiverLecteur $command): void
    {
        $lecteur = $command->lecteur;

        if ($lecteur->hasPretsEnCours()) {
            throw new PretsEnCoursException();
        }

        $lecteur->archiver();
        $this->lecteurRepository->save($lecteur);

        $this->notifier($lecteur);
    }

    public function notifier(Lecteur $lecteur): void
    {
        if (null === $lecteur->email) {
            return;
        }

        $this->mailer->send(new ArchivageEmail($lecteur));
    }
}
